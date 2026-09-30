import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FilterMatchMode, PaginationFilterConstraint } from '../../../../core/paginate';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { TransferStatusChipComponent } from '../../components/transfer-status-chip/transfer-status-chip.component';
import {
  StockTransferRow,
  TRANSFER_CANCEL_PERMISSION,
  TRANSFER_DISPATCH_PERMISSION,
  TRANSFER_RECEIVE_PERMISSION,
  hasRemito,
  isCancellable,
  isCancellableHere,
  isReceivable,
  isReceivableHere,
} from '../../data-access/stock-transfer.model';
import { StockTransfersApiService } from '../../data-access/stock-transfers-api.service';
import {
  TRANSFERS_DEFAULT_SORT_PARAM,
  createStockTransfersPaginator,
} from '../../data-access/stock-transfers-list.query';
import {
  NEW_STOCK_TRANSFER_PATH,
  STOCK_TRANSFERS_PATH,
  stockTransferDetailPath,
  stockTransferRemitoPath,
} from '../../stock-transfers.paths';

/**
 * El listado de traslados de stock: lo que salió, lo que está en viaje y lo que hay que recibir.
 *
 * La pantalla se ordena alrededor de una sola cosa: **el stock en viaje no existe en ningún
 * depósito**. Por eso lo primero que se ve —cuando lo hay— es cuántos traslados esperan que esta
 * sucursal los confirme, y por eso la acción de recibir se apaga con el motivo por tooltip en vez
 * de desaparecer: una fila sin el botón se lee como un traslado que no se puede recibir nunca, y no
 * como uno que se recibe desde otra sucursal.
 */
@Component({
  selector: 'app-stock-transfers-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
    TransferStatusChipComponent,
  ],
  providers: [StockTransfersApiService],
  templateUrl: './stock-transfers.page.html',
  styleUrl: './stock-transfers.page.css',
})
export class StockTransfersPage implements OnInit {
  private readonly api = inject(StockTransfersApiService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);

  protected readonly paginator = createStockTransfersPaginator((query) => this.api.paginate(query));

  /** Despachar exige su propio permiso; ver el listado alcanza con `stock.view`. */
  protected readonly canDispatch = this.auth.hasPermission(TRANSFER_DISPATCH_PERMISSION);
  protected readonly canReceive = this.auth.hasPermission(TRANSFER_RECEIVE_PERMISSION);
  protected readonly canCancel = this.auth.hasPermission(TRANSFER_CANCEL_PERMISSION);

  protected readonly activeBranch = this.auth.selectedBranch;

  /** Cuántos traslados esperan que esta sucursal los reciba. Total de la sucursal, no de la página. */
  protected readonly pendingReception = signal(0);

  protected readonly displayedColumns = [
    'dateCreated',
    'quantity',
    'source',
    'target',
    'transferStatus',
    'actions',
  ];

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Borrador local del buscador; se vuelca al paginador con debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly statusFilter = signal<string | null>(null);
  protected readonly modeFilter = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);

  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  /** Mientras se confirma una recepción o se cancela, la fila no ofrece repetir la acción. */
  private readonly receivingUuid = signal<string | null>(null);
  private readonly cancellingUuid = signal<string | null>(null);

  /**
   * Las acciones de cada fila, resueltas de una sola vez por página.
   *
   * Es por fila y no una lista común porque **recibir no está disponible en todas**: sólo un
   * traslado en viaje se recibe, y sólo desde la sucursal de destino —el backend rechaza cualquier
   * otra—. En el resto el botón va apagado y con el motivo por etiqueta, que es lo que muestra el
   * tooltip.
   *
   * Se memoiza en un mapa porque el template la pide una vez por fila y por ciclo de detección de
   * cambios; recalcularla ahí adentro armaría un array nuevo cada vez.
   */
  protected readonly rowActionsByUuid = computed<ReadonlyMap<string, readonly RowAction[]>>(() => {
    // El idioma entra como dependencia: las etiquetas se traducen acá, no con el pipe.
    this.language.currentLang();

    const branchUuid = this.auth.selectedBranchUuid();
    const receiving = this.receivingUuid();
    const cancelling = this.cancellingUuid();

    return new Map(
      this.paginator
        .items()
        .map((transfer): [string, readonly RowAction[]] => [
          transfer.uuid,
          [
            { id: 'detail', icon: 'visibility', label: this.label('detail') },
            this.receiveAction(transfer, branchUuid, receiving),
            this.cancelAction(transfer, branchUuid, cancelling),
            {
              id: 'remito',
              icon: 'print',
              label: hasRemito(transfer) ? this.label('remito') : this.label('remitoCancelled'),
              disabled: !hasRemito(transfer),
            },
          ],
        ]),
    );
  });

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stockTransfers', link: STOCK_TRANSFERS_PATH },
    ]);
  }

  ngOnInit(): void {
    // El orden por defecto entra como un query param más para que lo pise el de la URL si lo hay.
    const params: Params = {
      sort: TRANSFERS_DEFAULT_SORT_PARAM,
      ...this.route.snapshot.queryParams,
    };
    this.paginator.applyQueryParams(params);
    this.restoreFilterSelection();
    this.loadSummary();
  }

  protected onCreate(): void {
    void this.router.navigate([NEW_STOCK_TRANSFER_PATH]);
  }

  protected onRowAction(actionId: string, transfer: StockTransferRow): void {
    if (actionId === 'detail') {
      void this.router.navigate([stockTransferDetailPath(transfer.uuid)]);
      return;
    }

    if (actionId === 'remito') {
      void this.router.navigate([stockTransferRemitoPath(transfer.uuid)]);
      return;
    }

    if (actionId === 'receive') {
      this.confirmReception(transfer);
      return;
    }

    if (actionId === 'cancel') {
      this.confirmCancellation(transfer);
    }
  }

  protected rowActionsFor(transfer: StockTransferRow): readonly RowAction[] {
    return this.rowActionsByUuid().get(transfer.uuid) ?? [];
  }

  /** Si el traslado espera que **esta** sucursal lo reciba: es lo que le da el tono de alerta. */
  protected awaitsThisBranch(transfer: StockTransferRow): boolean {
    return isReceivableHere(transfer, this.auth.selectedBranchUuid());
  }

  /** Filtra el listado a lo que hay que recibir, que es lo que el aviso de arriba ofrece. */
  protected onShowPending(): void {
    this.statusFilter.set('IN_TRANSIT');
    this.filtersOpen.set(true);
    this.applyFilters();
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
    void this.syncQueryParams();
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
    void this.syncQueryParams();
  }

  protected onRefresh(): void {
    this.paginator.refresh();
    this.loadSummary();
  }

  protected onToggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onStatusChange(status: string | null): void {
    this.statusFilter.set(status);
    this.applyFilters();
  }

  protected onModeChange(mode: string | null): void {
    this.modeFilter.set(mode);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.statusFilter.set(null);
    this.modeFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  /**
   * Recibir es una entrada de stock con costo: acredita el destino, actualiza el costo del producto
   * en esta sucursal y recalcula los precios de las listas que declara su regla. No se dispara sin
   * confirmación, y el diálogo dice exactamente eso.
   */
  private confirmReception(transfer: StockTransferRow): void {
    const label = transfer.publicId ?? this.translate.instant('stockTransfers.list.noPublicId');

    this.confirm
      .confirm({
        title: this.translate.instant('stockTransfers.receive.title', { transfer: label }),
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
          this.receive(transfer);
        }
      });
  }

  private receive(transfer: StockTransferRow): void {
    this.receivingUuid.set(transfer.uuid);

    this.api
      .receive(transfer.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.receivingUuid.set(null);
          this.toast.success(this.translate.instant('stockTransfers.receive.success'));
          this.paginator.refresh();
          this.loadSummary();
        },
        error: (error: unknown) => {
          this.receivingUuid.set(null);
          this.toast.error(
            resolveApiErrorMessage(
              error,
              this.translate.instant('stockTransfers.receive.error'),
            ),
          );
          // El traslado pudo cambiar de estado desde otra sucursal: lo que se ve ya no vale.
          this.paginator.refresh();
          this.loadSummary();
        },
      });
  }

  /**
   * Cancelar devuelve la mercadería al depósito de origen recreando cada lote. Es lo contrario de
   * despachar y mueve stock, así que no se dispara sin confirmación.
   */
  private confirmCancellation(transfer: StockTransferRow): void {
    const label = transfer.publicId ?? this.translate.instant('stockTransfers.list.noPublicId');

    this.confirm
      .confirm({
        title: this.translate.instant('stockTransfers.cancel.title', { transfer: label }),
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
          this.cancel(transfer);
        }
      });
  }

  private cancel(transfer: StockTransferRow): void {
    this.cancellingUuid.set(transfer.uuid);

    this.api
      .cancel(transfer.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancellingUuid.set(null);
          this.toast.success(this.translate.instant('stockTransfers.cancel.success'));
          this.paginator.refresh();
          this.loadSummary();
        },
        error: (error: unknown) => {
          this.cancellingUuid.set(null);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stockTransfers.cancel.error')),
          );
          // Pudo cambiar de estado desde la otra punta: lo que se ve ya no vale.
          this.paginator.refresh();
          this.loadSummary();
        },
      });
  }

  /**
   * El contador del aviso. Que falle no rompe el listado —que se pide aparte—, así que se cae en
   * silencio a cero: un aviso que no aparece es mejor que un listado que no carga por un aviso.
   */
  private loadSummary(): void {
    this.api
      .summary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.pendingReception.set(summary.pendingReception ?? 0),
        error: () => this.pendingReception.set(0),
      });
  }

  /**
   * La acción de recibir de una fila, con el motivo por el que está apagada cuando lo está: el
   * traslado ya se recibió, se canceló, o su destino es otra sucursal.
   */
  private receiveAction(
    transfer: StockTransferRow,
    branchUuid: string | null,
    busy: string | null,
  ): RowAction {
    if (!this.canReceive) {
      return {
        id: 'receive',
        icon: 'check_circle',
        label: this.label('receiveNoPermission'),
        disabled: true,
      };
    }

    const here = isReceivableHere(transfer, branchUuid);
    return {
      id: 'receive',
      icon: 'check_circle',
      label: here
        ? this.label('receive')
        : this.receiveBlockedLabel(transfer),
      color: here ? 'primary' : undefined,
      disabled: !here || busy === transfer.uuid,
    };
  }

  /**
   * La acción de cancelar de una fila, con el motivo por el que está apagada cuando lo está: el
   * traslado ya no está en viaje, o salió de otra sucursal.
   */
  private cancelAction(
    transfer: StockTransferRow,
    branchUuid: string | null,
    busy: string | null,
  ): RowAction {
    if (!this.canCancel) {
      return {
        id: 'cancel',
        icon: 'cancel',
        label: this.label('cancelNoPermission'),
        disabled: true,
      };
    }

    const here = isCancellableHere(transfer, branchUuid);
    return {
      id: 'cancel',
      icon: 'cancel',
      label: here ? this.label('cancel') : this.cancelBlockedLabel(transfer),
      color: here ? 'warn' : undefined,
      disabled: !here || busy === transfer.uuid,
    };
  }

  private cancelBlockedLabel(transfer: StockTransferRow): string {
    if (!isCancellable(transfer)) {
      return this.translate.instant(
        `stockTransfers.list.actions.cancelBlocked.${transfer.transferStatus}`,
      );
    }

    return this.translate.instant('stockTransfers.list.actions.cancelOtherBranch', {
      branch: transfer.sourceBranch?.name ?? '',
    });
  }

  private receiveBlockedLabel(transfer: StockTransferRow): string {
    if (!isReceivable(transfer)) {
      return this.translate.instant(
        `stockTransfers.list.actions.receiveBlocked.${transfer.transferStatus}`,
      );
    }

    return this.translate.instant('stockTransfers.list.actions.receiveOtherBranch', {
      branch: transfer.targetBranch?.name ?? '',
    });
  }

  private label(key: string): string {
    return this.translate.instant(`stockTransfers.list.actions.${key}`);
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const status = this.statusFilter();
    if (status) {
      filters['transferStatus'] = { value: status, matchMode: FilterMatchMode.Equals };
    }

    const mode = this.modeFilter();
    if (mode) {
      filters['transferMode'] = { value: mode, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /** Rehidrata los selects con los filtros que el paginador restauró de la URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const status = firstConstraint(filters['transferStatus']);
    this.statusFilter.set(typeof status?.value === 'string' ? status.value : null);

    const mode = firstConstraint(filters['transferMode']);
    this.modeFilter.set(typeof mode?.value === 'string' ? mode.value : null);

    this.filtersOpen.set(this.statusFilter() !== null || this.modeFilter() !== null);
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator.toQueryParams(),
      replaceUrl: true,
    });
  }
}

function firstConstraint(
  value: PaginationFilterConstraint | PaginationFilterConstraint[] | undefined,
): PaginationFilterConstraint | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
