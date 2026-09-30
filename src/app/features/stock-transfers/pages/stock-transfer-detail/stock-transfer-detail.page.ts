import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  LineSerialsDialogComponent,
  LineSerialsDialogData,
} from '../../components/line-serials-dialog/line-serials-dialog.component';
import { TransferStatusChipComponent } from '../../components/transfer-status-chip/transfer-status-chip.component';
import {
  StockTransferDetail,
  StockTransferLine,
  TRANSFER_CANCEL_PERMISSION,
  TRANSFER_RECEIVE_PERMISSION,
  anyLineHasBatch,
  anyLineHasExpiration,
  hasRemito,
  isCancellable,
  isCancellableHere,
  isReceivable,
  isReceivableHere,
  serialsFitInline,
  serialsNeedDialog,
  unitAbbrevKey,
} from '../../data-access/stock-transfer.model';
import { StockTransfersApiService } from '../../data-access/stock-transfers-api.service';
import {
  STOCK_TRANSFERS_PATH,
  stockTransferRemitoPath,
} from '../../stock-transfers.paths';

/** Un paso del recorrido del traslado, tal como lo dibuja la línea de tiempo. */
interface TimelineStep {
  labelKey: string;
  /** Datos que la etiqueta interpola (la cantidad despachada, por ejemplo). */
  params?: Record<string, unknown>;
  at?: number | string | null;
  state: 'done' | 'current' | 'pending';
}

/**
 * El detalle de un traslado: por dónde va, qué lleva y qué falta para cerrarlo.
 *
 * La pantalla responde una pregunta que el listado no puede: **de qué lotes salió cada producto**.
 * El traslado guarda una línea por lote —con su número, su vencimiento y su costo— porque eso es lo
 * que el destino recrea al recibir, y es lo único que permite auditar después por qué el costo del
 * producto en la sucursal de destino cambió como cambió.
 */
@Component({
  selector: 'app-stock-transfer-detail-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    LoadStateComponent,
    LocalizedDatePipe,
    TransferStatusChipComponent,
  ],
  providers: [StockTransfersApiService],
  templateUrl: './stock-transfer-detail.page.html',
  styleUrl: './stock-transfer-detail.page.css',
})
export class StockTransferDetailPage implements OnInit {
  private readonly api = inject(StockTransfersApiService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);

  private readonly uuid = this.route.snapshot.paramMap.get('uuid') ?? '';

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly transfer = signal<StockTransferDetail | null>(null);
  protected readonly receiving = signal(false);
  protected readonly cancelling = signal(false);

  protected readonly canReceive = this.auth.hasPermission(TRANSFER_RECEIVE_PERMISSION);
  protected readonly canCancel = this.auth.hasPermission(TRANSFER_CANCEL_PERMISSION);
  protected readonly stockTransfersPath = STOCK_TRANSFERS_PATH;
  protected readonly LoadState = LoadState;

  /** Si **esta** sucursal puede confirmarlo. Sin esto el botón llevaría derecho a un 403. */
  protected readonly receivableHere = computed(() => {
    const transfer = this.transfer();
    return transfer !== null && isReceivableHere(transfer, this.auth.selectedBranchUuid());
  });

  /** Por qué el botón de recibir está apagado, cuando lo está. Vacío si está disponible. */
  protected readonly receiveBlockedReason = computed(() => {
    const transfer = this.transfer();
    if (!transfer || this.receivableHere()) {
      return '';
    }

    if (!this.canReceive) {
      return this.translate.instant('stockTransfers.list.actions.receiveNoPermission');
    }

    if (!isReceivable(transfer)) {
      return this.translate.instant(
        `stockTransfers.list.actions.receiveBlocked.${transfer.transferStatus}`,
      );
    }

    return this.translate.instant('stockTransfers.list.actions.receiveOtherBranch', {
      branch: transfer.targetBranch?.name ?? '',
    });
  });

  /** Si **esta** sucursal puede cancelarlo: es la que despachó, que es donde vuelve la mercadería. */
  protected readonly cancellableHere = computed(() => {
    const transfer = this.transfer();
    return transfer !== null && isCancellableHere(transfer, this.auth.selectedBranchUuid());
  });

  /** Por qué el botón de cancelar está apagado, cuando lo está. Vacío si está disponible. */
  protected readonly cancelBlockedReason = computed(() => {
    const transfer = this.transfer();
    if (!transfer || this.cancellableHere()) {
      return '';
    }

    if (!this.canCancel) {
      return this.translate.instant('stockTransfers.list.actions.cancelNoPermission');
    }

    if (!isCancellable(transfer)) {
      return this.translate.instant(
        `stockTransfers.list.actions.cancelBlocked.${transfer.transferStatus}`,
      );
    }

    return this.translate.instant('stockTransfers.list.actions.cancelOtherBranch', {
      branch: transfer.sourceBranch?.name ?? '',
    });
  });

  protected readonly hasRemito = computed(() => {
    const transfer = this.transfer();
    return transfer !== null && hasRemito(transfer);
  });

  /** Total de unidades del traslado, sumando las líneas: es el número que cierra la tabla. */
  protected readonly totalQuantity = computed(() =>
    (this.transfer()?.lines ?? []).reduce((total, line) => total + (line.quantity ?? 0), 0),
  );

  protected readonly lineCount = computed(() => this.transfer()?.lines?.length ?? 0);

  /**
   * Las columnas de partida se dibujan **sólo si alguna línea las usa**.
   *
   * La tabla tiene que servir para los cuatro ejes, no sólo para el que lleva lotes: en un traslado
   * de notebooks o de mercadería suelta, «Lote» y «Vencimiento» son dos columnas de guiones que
   * empujan la cantidad y el costo fuera de la vista para no decir nada.
   */
  protected readonly showBatch = computed(() => anyLineHasBatch(this.transfer()?.lines));

  protected readonly showExpiration = computed(() => anyLineHasExpiration(this.transfer()?.lines));

  /** Lo que abarca el «Total» del pie: todo lo que hay antes de la cantidad. */
  protected readonly footerColspan = computed(
    () => 1 + (this.showBatch() ? 1 : 0) + (this.showExpiration() ? 1 : 0),
  );

  /** La unidad con la que se lee la cantidad de una línea. Vacío si el producto no declara una. */
  protected unitOf(line: StockTransferLine): string {
    const key = unitAbbrevKey(line);
    return key ? this.translate.instant(key) : '';
  }

  /**
   * Las series se muestran sueltas cuando son pocas y resumidas en un botón cuando son muchas.
   *
   * Dos o tres equipos —el traslado de electro corriente— se leen en la fila sin un solo clic;
   * cuarenta convierten la fila en un muro y la tabla deja de leerse, y ahí el clic vale lo que
   * cuesta.
   */
  protected readonly showsSerialsInline = serialsFitInline;

  protected readonly showsSerialsButton = serialsNeedDialog;

  protected onShowSerials(line: StockTransferLine): void {
    const data: LineSerialsDialogData = {
      productName: line.product?.name ?? '',
      serials: line.serials ?? [],
    };
    this.dialog.open<LineSerialsDialogComponent, LineSerialsDialogData, boolean>(
      LineSerialsDialogComponent,
      { width: '34rem', maxWidth: '95vw', maxHeight: '90vh', autoFocus: 'first-heading', data },
    );
  }

  /**
   * El recorrido, de creado a recibido.
   *
   * Los pasos que faltan se dibujan igual que los cumplidos porque lo que la pantalla tiene que
   * dejar claro es **qué falta**: un traslado en viaje sin el paso «recibido» a la vista se lee
   * como terminado.
   *
   * El cancelado es la excepción: ahí el recorrido **termina**, y arrastrar un «recibido» pendiente
   * prometería un paso que ya no va a pasar nunca.
   */
  protected readonly timeline = computed<readonly TimelineStep[]>(() => {
    const transfer = this.transfer();
    if (!transfer) {
      return [];
    }

    const steps: TimelineStep[] = [
      { labelKey: 'stockTransfers.detail.timeline.created', at: transfer.dateCreated, state: 'done' },
      {
        labelKey: 'stockTransfers.detail.timeline.dispatched',
        params: { quantity: transfer.quantity ?? 0 },
        at: transfer.dateCreated,
        state: 'done',
      },
    ];

    if (transfer.transferStatus === 'CANCELLED') {
      steps.push({
        labelKey: 'stockTransfers.detail.timeline.cancelled',
        params: { warehouse: transfer.fromWarehouse?.name ?? '' },
        at: transfer.dateCancelled,
        state: 'done',
      });
      return steps;
    }

    const received = transfer.transferStatus === 'RECEIVED';
    steps.push(
      {
        labelKey: 'stockTransfers.detail.timeline.awaiting',
        state: received ? 'done' : 'current',
      },
      {
        labelKey: 'stockTransfers.detail.timeline.received',
        at: transfer.dateReceived,
        state: received ? 'done' : 'pending',
      },
    );
    return steps;
  });

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stockTransfers', link: STOCK_TRANSFERS_PATH },
      { label: this.transfer()?.publicId ?? this.translate.instant('stockTransfers.detail.title') },
    ]);
  }

  ngOnInit(): void {
    this.load();
  }

  protected onRetry(): void {
    this.load();
  }

  protected onBack(): void {
    void this.router.navigate([STOCK_TRANSFERS_PATH]);
  }

  protected onRemito(): void {
    void this.router.navigate([stockTransferRemitoPath(this.uuid)]);
  }

  /**
   * Cancelar devuelve la mercadería al depósito de origen recreando cada lote con su número, su
   * vencimiento y su costo. Es lo contrario de despachar y mueve stock, así que se confirma.
   */
  protected onCancel(): void {
    const transfer = this.transfer();
    if (!transfer || !this.cancellableHere() || this.cancelling()) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('stockTransfers.cancel.title', {
          transfer: transfer.publicId ?? '',
        }),
        message: this.translate.instant('stockTransfers.cancel.message', {
          warehouse: transfer.fromWarehouse?.name ?? '',
          quantity: transfer.quantity ?? 0,
        }),
        confirmLabel: this.translate.instant('stockTransfers.cancel.confirm'),
        cancelLabel: this.translate.instant('stockTransfers.cancel.cancel'),
        confirmColor: 'warn',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.cancel();
        }
      });
  }

  private cancel(): void {
    this.cancelling.set(true);

    this.api
      .cancel(this.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transfer) => {
          this.cancelling.set(false);
          this.transfer.set(transfer);
          this.toast.success(this.translate.instant('stockTransfers.cancel.success'));
        },
        error: (error: unknown) => {
          this.cancelling.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stockTransfers.cancel.error')),
          );
          // Pudo cambiar de estado desde la otra punta: lo que se ve ya no vale.
          this.load();
        },
      });
  }

  /**
   * Recibir es una entrada de stock con costo: acredita el destino, actualiza el costo del producto
   * en esa sucursal y recalcula el precio de venta de las listas que declara su regla. El diálogo
   * dice exactamente eso, porque es lo que el operador está autorizando.
   */
  protected onReceive(): void {
    const transfer = this.transfer();
    if (!transfer || !this.receivableHere() || this.receiving()) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('stockTransfers.receive.title', {
          transfer: transfer.publicId ?? '',
        }),
        message: this.translate.instant('stockTransfers.receive.message', {
          warehouse: transfer.toWarehouse?.name ?? '',
          quantity: transfer.quantity ?? 0,
        }),
        confirmLabel: this.translate.instant('stockTransfers.receive.confirm'),
        cancelLabel: this.translate.instant('stockTransfers.receive.cancel'),
        confirmColor: 'primary',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.receive();
        }
      });
  }

  private receive(): void {
    this.receiving.set(true);

    this.api
      .receive(this.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transfer) => {
          this.receiving.set(false);
          this.transfer.set(transfer);
          this.toast.success(this.translate.instant('stockTransfers.receive.success'));
        },
        error: (error: unknown) => {
          this.receiving.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stockTransfers.receive.error')),
          );
          // Pudo cambiar de estado desde la sucursal de destino: lo que se ve ya no vale.
          this.load();
        },
      });
  }

  private load(): void {
    this.loadState.set(LoadState.Loading);

    this.api
      .getByUuid(this.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transfer) => {
          this.transfer.set(transfer);
          this.loadState.set(LoadState.Success);
        },
        error: () => this.loadState.set(LoadState.Error),
      });
  }
}
