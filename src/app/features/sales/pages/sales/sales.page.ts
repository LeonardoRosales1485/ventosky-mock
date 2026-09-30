import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { UpperCasePipe } from '@angular/common';
import { downloadCsv, toCsv } from '../../../../shared/utils/csv-export';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { openOrderDetailDialog } from '../../../../core/orders/order-detail-dialog/order-detail-dialog.component';
import { OrderDto } from '../../../../core/orders/order-commit.model';
import { OrdersApiService } from '../../../../core/orders/orders-api.service';
import { FilterMatchMode, PaginationFilterConstraint } from '../../../../core/paginate';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  SALE_CREATE_PERMISSION,
  SaleCustomerDto,
  SaleVoucherDto,
} from '../../data-access/sale.model';
import { SalesCatalogApiService } from '../../data-access/sales-catalog-api.service';
import { SALES_DEFAULT_SORT_PARAM, createSalesPaginator } from '../../data-access/sales-list.query';
import { MY_PURCHASES_PATH, POS_PATH, SALES_PATH } from '../../sales.paths';

@Component({
  selector: 'app-sales-page',
  imports: [
    MatButtonToggleModule,
    UpperCasePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    LocalizedDatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [OrdersApiService, SalesCatalogApiService],
  templateUrl: './sales.page.html',
  styleUrl: './sales.page.css',
})
export class SalesPage implements OnInit {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly catalogApi = inject(SalesCatalogApiService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly language = inject(LanguageService);

  protected readonly paginator = createSalesPaginator((query) => this.ordersApi.paginate(query));

  /**
   * «Mis compras»: la misma pantalla para el cliente del portal, que sólo tiene `order.view_own`. El
   * backend ya le devuelve únicamente sus ventas; acá se le esconde lo que es de la empresa —la columna y
   * el filtro de cliente, que siempre sería él, y el alta—.
   */
  protected readonly own = this.route.snapshot.data['mode'] === 'own';

  /** El alta vive en otra área del panel, así que el botón exige su permiso y no el del listado. */
  protected readonly canCreate = !this.own && this.auth.hasPermission(SALE_CREATE_PERMISSION);

  /**
   * La única acción de la fila es **ver**, al revés que en compras: una venta es un commit atómico y
   * el backend no acepta ninguna escritura sobre ella —`/order/save` responde 410 y el convert sólo
   * alcanza a una orden de compra borrador—, así que no hay nada que editar. Revisar sí: el
   * paginado trae el encabezado y las líneas viven en el detalle.
   */
  protected readonly displayedColumns = [
    'publicId',
    'dateOperation',
    ...(this.own ? [] : ['customer']),
    'voucher',
    'branch',
    'total',
    'actions',
  ];

  /**
   * Se resuelve una sola vez por idioma y no por fila: la acción es la misma en todas, y el template
   * la pide una vez por fila y por ciclo de detección de cambios.
   */
  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    // El idioma entra como dependencia: la etiqueta se traduce acá, no con el pipe.
    this.language.currentLang();

    return [
      { id: 'view', icon: 'visibility', label: this.translate.instant('sales.list.actions.view') },
    ];
  });

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly customers = signal<readonly SaleCustomerDto[]>([]);
  protected readonly vouchers = signal<readonly SaleVoucherDto[]>([]);

  protected readonly customerFilter = signal<string | null>(null);
  protected readonly voucherFilter = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);

  /** Período del segmentado: arranca en «Este mes», como la Propuesta B. */
  protected readonly period = signal<'today' | 'month' | 'all'>('month');

  /** Suma de los totales que se están viendo, para el pie de la tabla. */
  protected readonly pageTotal = computed(() =>
    this.paginator.items().reduce((sum, sale) => sum + Number(sale.orderCheckout?.totalAmount ?? 0), 0),
  );

  protected readonly activeFilters = computed(
    () => Object.keys(this.paginator.filters()).filter((key) => key !== 'period').length,
  );

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => {
      return [
        BREADCRUMB_HOME,
        this.own
          ? { labelKey: 'nav.items.myPurchases', link: MY_PURCHASES_PATH }
          : { labelKey: 'nav.items.sales', link: SALES_PATH },
      ];
    });
  }

  ngOnInit(): void {
    this.loadFilterOptions();

    // El orden por defecto entra como un query param más para que lo pise el de la URL si lo hay.
    const params: Params = {
      sort: SALES_DEFAULT_SORT_PARAM,
      ...this.route.snapshot.queryParams,
    };
    this.paginator.applyQueryParams(params);
    this.restoreFilterSelection();
    if (!this.paginator.filters()['period'] && !this.route.snapshot.queryParams['period']) {
      this.applyFilters();
    }
  }

  /** El alta es otra pantalla —y otra área—: el punto de venta, en `/panel/pos`. */
  protected onCreate(): void {
    void this.router.navigate([POS_PATH]);
  }

  /**
   * Abre el comprobante en sólo lectura. Es la única forma de ver sus líneas: el paginado devuelve
   * el encabezado, y de acá sale también el indicador de los productos que ya no están en el
   * catálogo como estaban cuando se registró la venta.
   */
  protected onRowAction(actionId: string, sale: OrderDto): void {
    if (actionId !== 'view') {
      return;
    }

    openOrderDetailDialog(this.dialog, sale, 'sale');
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
  }

  protected onToggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onCustomerChange(uuid: string | null): void {
    this.customerFilter.set(uuid);
    this.applyFilters();
  }

  protected onVoucherChange(uuid: string | null): void {
    this.voucherFilter.set(uuid);
    this.applyFilters();
  }

  protected onPeriodChange(period: 'today' | 'month' | 'all'): void {
    this.period.set(period);
    this.applyFilters();
  }

  /** «Factura A (venta)» → «Factura A»: la pill no repite la operación, que ya dice la pantalla. */
  protected shortVoucher(name: string): string {
    return name.replace(/\s*\([^)]*\)\s*$/, '');
  }

  /** Exporta lo que se está viendo, tal como se ve. */
  protected onExport(): void {
    const t = (key: string) => this.translate.instant(`sales.list.columns.${key}`);
    const rows = this.paginator.items().map((sale) => [
      sale.publicId ?? '',
      sale.dateOperation ?? '',
      sale.partyRole?.name ?? this.translate.instant('sales.list.finalConsumer'),
      sale.voucher?.name ?? '',
      sale.branch?.name ?? '',
      sale.orderCheckout?.totalAmount ?? '',
    ]);
    downloadCsv(
      'ventas.csv',
      toCsv([t('publicId'), t('dateOperation'), t('customer'), t('voucher'), t('branch'), t('total')], rows),
    );
  }

  protected onClearFilters(): void {
    this.customerFilter.set(null);
    this.voucherFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const customerUuid = this.customerFilter();
    if (customerUuid) {
      filters['customer'] = { value: customerUuid, matchMode: FilterMatchMode.Equals };
    }

    const voucherUuid = this.voucherFilter();
    if (voucherUuid) {
      filters['voucher'] = { value: voucherUuid, matchMode: FilterMatchMode.Equals };
    }

    const since = periodStart(this.period());
    if (since) {
      filters['period'] = { value: since, matchMode: FilterMatchMode.GreaterThanOrEqualTo };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /** Re-hydrates the selects from the filters the paginator restored from the URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const customer = firstConstraint(filters['customer']);
    this.customerFilter.set(typeof customer?.value === 'string' ? customer.value : null);

    const period = firstConstraint(filters['period']);
    if (period) {
      this.period.set(period.value === periodStart('today') ? 'today' : 'month');
    }

    const voucher = firstConstraint(filters['voucher']);
    this.voucherFilter.set(typeof voucher?.value === 'string' ? voucher.value : null);

    this.filtersOpen.set(this.customerFilter() !== null || this.voucherFilter() !== null);
  }

  /**
   * Los catálogos de los selects. Que fallen no rompe el listado —que ya se está pidiendo aparte—,
   * así que sólo se avisa: la pantalla sigue sirviendo para buscar y paginar. El cliente del portal no
   * elige cliente, y tampoco puede listarlos: no se le piden.
   */
  private loadFilterOptions(): void {
    if (!this.own) {
      this.catalogApi
        .getCustomers()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (customers) => this.customers.set(customers),
          error: () => this.toast.error(this.translate.instant('sales.list.toasts.customersError')),
        });
    }

    this.catalogApi
      .getVouchers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (vouchers) => this.vouchers.set(vouchers),
        error: () => this.toast.error(this.translate.instant('sales.list.toasts.vouchersError')),
      });
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator.toQueryParams(),
      replaceUrl: true,
    });
  }
}

/** Inicio del período como fecha local `YYYY-MM-DD`, o `null` para «Todo». */
function periodStart(period: 'today' | 'month' | 'all'): string | null {
  if (period === 'all') {
    return null;
  }
  const now = new Date();
  const day = period === 'today' ? now.getDate() : 1;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;
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
