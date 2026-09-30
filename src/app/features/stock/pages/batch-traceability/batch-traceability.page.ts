import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { BatchTraceabilityDto } from '../../../../core/stock/stock-batch.model';
import { StockBatchesApiService } from '../../../../core/stock/stock-batches-api.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { ExpirationChipComponent } from '../../../../shared/components/expiration-chip/expiration-chip.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { downloadCsv, toCsv } from '../../data-access/csv-export';
import { STOCK_EXPIRATION_VIEW_PERMISSION } from '../../data-access/expiration.model';
import { EXPIRATIONS_PATH } from '../../stock.paths';

/**
 * La trazabilidad de una partida (§7.5, wireframe `1k`): qué es, cuánto entró, se vendió y se
 * trasladó, cuánto queda, y las dos listas que justifican el módulo ante un rubro regulado.
 *
 * «Del lote a las ventas» es el recall: si el laboratorio retira la partida, ésta es la lista de a
 * quién hay que llamar. «Movimientos del lote» es su kardex entero, del primer ingreso al último
 * egreso. Sale de `stock_items` y `stock_movements`, sin tabla nueva: hay pantalla nueva.
 */
@Component({
  selector: 'app-batch-traceability-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    ExpirationChipComponent,
    LoadStateComponent,
  ],
  templateUrl: './batch-traceability.page.html',
  styleUrl: './batch-traceability.page.css',
})
export class BatchTraceabilityPage implements OnInit {
  private readonly api = inject(StockBatchesApiService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly uuid = this.route.snapshot.paramMap.get('uuid') ?? '';

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly batch = signal<BatchTraceabilityDto | null>(null);
  protected readonly writingOff = signal(false);

  protected readonly canWriteOff = this.auth.hasPermission(STOCK_EXPIRATION_VIEW_PERMISSION);
  protected readonly LoadState = LoadState;

  /** Sólo las ventas: es la lista del recall. Las compras quedan en el kardex. */
  protected readonly sales = computed(() =>
    (this.batch()?.operations ?? []).filter((operation) => operation.operationType === 'SALE'),
  );

  protected readonly canWriteOffBalance = computed(
    () => this.canWriteOff && (this.batch()?.currentQuantity ?? 0) > 0,
  );

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stock', link: EXPIRATIONS_PATH },
      { label: this.batch()?.batchNumber ?? this.translate.instant('stock.batch.title') },
    ]);
  }

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loadState.set(LoadState.Loading);
    this.api
      .getTraceability(this.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batch) => {
          this.batch.set(batch);
          this.loadState.set(LoadState.Success);
        },
        error: () => this.loadState.set(LoadState.Error),
      });
  }

  protected onBack(): void {
    void this.router.navigateByUrl(EXPIRATIONS_PATH);
  }

  /** Dar de baja lo que queda: el mismo ajuste de egreso `EXPIRED` del panel, sobre esta partida. */
  protected onWriteOff(): void {
    const batch = this.batch();
    if (!batch || !this.canWriteOffBalance()) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('stock.batch.writeOff.title'),
        message: this.translate.instant('stock.batch.writeOff.message', {
          batch: batch.batchNumber ?? '',
          quantity: batch.currentQuantity,
        }),
        confirmLabel: this.translate.instant('stock.batch.writeOff.confirm'),
        cancelLabel: this.translate.instant('stock.batch.writeOff.cancel'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.writeOff(batch.uuid);
        }
      });
  }

  /** Las ventas del lote, para llevarlas al teléfono. */
  protected onExport(): void {
    const batch = this.batch();
    if (!batch) {
      return;
    }

    const headers = ['date', 'voucher', 'customer', 'branch', 'quantity'].map((column) =>
      this.translate.instant(`stock.batch.export.${column}`),
    );
    const csv = toCsv(
      headers,
      this.sales().map((sale) => [
        sale.dateOperation ?? '',
        sale.publicId ?? '',
        sale.party?.name ?? this.translate.instant('stock.batch.finalConsumer'),
        sale.branch?.name ?? '',
        sale.quantity,
      ]),
    );

    downloadCsv(`lote-${batch.batchNumber ?? batch.uuid}.csv`, csv);
  }

  private writeOff(batchUuid: string): void {
    this.writingOff.set(true);
    this.api
      .writeOff({ batchUuids: [batchUuid] })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.writingOff.set(false);
          this.toast.success(
            this.translate.instant('stock.batch.writeOff.done', { quantity: result.totalQuantity }),
          );
          this.load();
        },
        error: (error: unknown) => {
          this.writingOff.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stock.batch.writeOff.error')),
          );
        },
      });
  }
}
