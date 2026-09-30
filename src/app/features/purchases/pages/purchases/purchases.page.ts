import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
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
import { OrderDto } from '../../../../core/orders/order-commit.model';
import { openOrderDetailDialog } from '../../../../core/orders/order-detail-dialog/order-detail-dialog.component';
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
  PURCHASE_CREATE_PERMISSION,
  PURCHASE_EDIT_PERMISSION,
  PurchaseSupplierDto,
  PurchaseVoucherDto,
  isEditablePurchase,
} from '../../data-access/purchase.model';
import { PurchasesCatalogApiService } from '../../data-access/purchases-catalog-api.service';
import {
  PURCHASES_DEFAULT_SORT_PARAM,
  createPurchasesPaginator,
} from '../../data-access/purchases-list.query';
import {
  MY_SALES_PATH,
  NEW_PURCHASE_PATH,
  PURCHASES_PATH,
  purchaseEditPath,
} from '../../purchases.paths';

@Component({
  selector: 'app-purchases-page',
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
    CurrencyDisplayComponent,
    LocalizedDatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [OrdersApiService, PurchasesCatalogApiService],
  templateUrl: './purchases.page.html',
  styleUrl: './purchases.page.css',
})
export class PurchasesPage implements OnInit {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly catalogApi = inject(PurchasesCatalogApiService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly dialog = inject(MatDialog);

  protected readonly paginator = createPurchasesPaginator((query) =>
    this.ordersApi.paginate(query),
  );

  /**
   * «Mis ventas»: la misma pantalla para el proveedor del portal, que sólo tiene `purchase.view_own`. El
   * backend ya le devuelve únicamente las compras que la empresa le hizo; acá se le esconde lo que es de
   * la empresa —la columna y el filtro de proveedor, que siempre sería él, el alta y la edición—.
   */
  protected readonly own = this.route.snapshot.data['mode'] === 'own';

  /** El alta vive en otra área del panel, así que el botón exige su permiso y no el del listado. */
  protected readonly canCreate = !this.own && this.auth.hasPermission(PURCHASE_CREATE_PERMISSION);
  protected readonly canEdit = !this.own && this.auth.hasPermission(PURCHASE_EDIT_PERMISSION);

  /**
   * La acción de cada fila, resuelta de una sola vez por página.
   *
   * Es por fila y no una lista común porque **editar no está disponible en todas**: el backend sólo
   * deja convertir una orden de compra borrador, así que en una compra ya aplicada el botón va
   * apagado y con el motivo por etiqueta —que es lo que el tooltip muestra— en vez de desaparecer:
   * una acción que a veces está y a veces no se lee como un error del listado.
   *
   * Se memoiza en un mapa porque el template la pide una vez por fila y por ciclo de detección de
   * cambios; recalcular ahí adentro armaría un array nuevo cada vez.
   */
  protected readonly rowActionsByUuid = computed<ReadonlyMap<string, readonly RowAction[]>>(() => {
    // El idioma entra como dependencia: las etiquetas se traducen acá, no con el pipe.
    this.language.currentLang();

    const view = this.translate.instant('purchases.list.actions.view');
    const edit = this.translate.instant('purchases.list.actions.edit');
    const blocked = this.translate.instant('purchases.list.actions.editBlocked');

    return new Map(
      this.paginator.items().map((purchase): [string, readonly RowAction[]] => {
        const editable = isEditablePurchase(purchase);

        return [
          purchase.uuid,
          [
            // Ver va primero y está siempre: es la acción que toda compra acepta, incluida la que ya
            // se aplicó y por eso no se puede editar.
            { id: 'view', icon: 'visibility', label: view },
            ...(this.canEdit
              ? [
                  {
                    id: 'edit',
                    icon: 'edit',
                    label: editable ? edit : blocked,
                    disabled: !editable,
                  },
                ]
              : []),
          ],
        ];
      }),
    );
  });

  /**
   * La columna de acciones está siempre: ver el comprobante no exige `purchase.edit`, y antes la
   * columna entera desaparecía con el permiso de editar.
   */
  protected readonly displayedColumns = [
    'publicId',
    'dateOperation',
    ...(this.own ? [] : ['supplier']),
    'voucher',
    'branch',
    'total',
    'actions',
  ];

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly suppliers = signal<readonly PurchaseSupplierDto[]>([]);
  protected readonly vouchers = signal<readonly PurchaseVoucherDto[]>([]);

  protected readonly supplierFilter = signal<string | null>(null);
  protected readonly voucherFilter = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);

  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

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
          ? { labelKey: 'nav.items.mySales', link: MY_SALES_PATH }
          : { labelKey: 'nav.items.purchases', link: PURCHASES_PATH },
      ];
    });
  }

  ngOnInit(): void {
    this.loadFilterOptions();

    // El orden por defecto entra como un query param más para que lo pise el de la URL si lo hay.
    const params: Params = {
      sort: PURCHASES_DEFAULT_SORT_PARAM,
      ...this.route.snapshot.queryParams,
    };
    this.paginator.applyQueryParams(params);
    this.restoreFilterSelection();
  }

  /** El alta es otra pantalla —y otra área—: `/panel/new-purchase`. */
  protected onCreate(): void {
    void this.router.navigate([NEW_PURCHASE_PATH]);
  }

  protected onRowAction(actionId: string, purchase: OrderDto): void {
    if (actionId === 'edit') {
      void this.router.navigate([purchaseEditPath(purchase.uuid)]);
      return;
    }

    if (actionId === 'view') {
      openOrderDetailDialog(this.dialog, purchase, 'purchase');
    }
  }

  /** Las acciones de la fila, o ninguna si el usuario no puede editar compras. */
  protected rowActionsFor(purchase: OrderDto): readonly RowAction[] {
    return this.rowActionsByUuid().get(purchase.uuid) ?? [];
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

  protected onSupplierChange(uuid: string | null): void {
    this.supplierFilter.set(uuid);
    this.applyFilters();
  }

  protected onVoucherChange(uuid: string | null): void {
    this.voucherFilter.set(uuid);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.supplierFilter.set(null);
    this.voucherFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const supplierUuid = this.supplierFilter();
    if (supplierUuid) {
      filters['supplier'] = { value: supplierUuid, matchMode: FilterMatchMode.Equals };
    }

    const voucherUuid = this.voucherFilter();
    if (voucherUuid) {
      filters['voucher'] = { value: voucherUuid, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /** Re-hydrates the selects from the filters the paginator restored from the URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const supplier = firstConstraint(filters['supplier']);
    this.supplierFilter.set(typeof supplier?.value === 'string' ? supplier.value : null);

    const voucher = firstConstraint(filters['voucher']);
    this.voucherFilter.set(typeof voucher?.value === 'string' ? voucher.value : null);

    this.filtersOpen.set(this.supplierFilter() !== null || this.voucherFilter() !== null);
  }

  /**
   * Los catálogos de los selects. Que fallen no rompe el listado —que ya se está pidiendo aparte—,
   * así que sólo se avisa: la pantalla sigue sirviendo para buscar y paginar. El proveedor del portal
   * no elige proveedor, y tampoco puede listarlos: no se le piden.
   */
  private loadFilterOptions(): void {
    if (!this.own) {
      this.catalogApi
        .getSuppliers()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (suppliers) => this.suppliers.set(suppliers),
          error: () =>
            this.toast.error(this.translate.instant('purchases.list.toasts.suppliersError')),
        });
    }

    this.catalogApi
      .getVouchers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (vouchers) => this.vouchers.set(vouchers),
        error: () =>
          this.toast.error(this.translate.instant('purchases.list.toasts.vouchersError')),
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
