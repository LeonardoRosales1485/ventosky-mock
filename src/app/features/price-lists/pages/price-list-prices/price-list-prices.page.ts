import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { UuidNameRef } from '../../../../core/http/api-refs';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  FilterMatchMode,
  MatTablePaginator,
  PaginationFilterConstraint,
} from '../../../../core/paginate';
import { PickerCategoryOption } from '../../../../core/product-picker/product-picker.model';
import { environment } from '../../../../../environments/environment';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { PriceListDto } from '../../data-access/price-list.model';
import {
  PRICE_HISTORY_VIEW_PERMISSION,
  PRODUCT_EDIT_PERMISSION,
  PRODUCT_TYPES,
  PriceListProductDto,
  ProductType,
  priceFor,
} from '../../data-access/price-list-product.model';
import { PriceListsApiService } from '../../data-access/price-lists-api.service';
import {
  PRICE_LISTS_PATHS,
  PRODUCT_PRICING_TAB,
  priceListPricesPath,
  productPriceHistoryPath,
  productPricingPath,
} from '../../price-lists.paths';

/**
 * Qué precio tiene cada producto **en una lista**.
 *
 * Es la contracara del ABM de listas: ahí se administra el encabezado —nombre, principal,
 * habilitada—, acá se ve lo que la lista efectivamente dice. Nació de sacar las columnas de precio
 * del catálogo de productos: una columna por lista hacía que el ancho de esa tabla dependiera de
 * cuántas listas tuviera la empresa, y la pregunta «¿cuánto vale esto en Mayorista?» se contesta
 * mejor mirando una lista entera que quince columnas de reojo.
 *
 * Pagina `/product/paginate-all`, el catálogo **plano**: las variantes sueltas, no la fila agrupada
 * del modelo. Es la unidad correcta porque el modelo no cotiza —cotizan sus variantes (RN-12)—, y
 * además es el único paginado que ve un producto recién creado, que todavía no tiene sucursales.
 *
 * De sólo lectura: el precio se carga por producto, así que las acciones de la fila llevan a la
 * solapa Precios de su ficha y a su historial, que es donde el precio se cambia y se explica.
 */
@Component({
  selector: 'app-price-list-prices-page',
  imports: [
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [PriceListsApiService],
  templateUrl: './price-list-prices.page.html',
  styleUrl: './price-list-prices.page.css',
})
export class PriceListPricesPage implements OnInit {
  private readonly priceListsApi = inject(PriceListsApiService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  private readonly priceListUuid = this.route.snapshot.paramMap.get('uuid') ?? '';

  /** El encabezado de la lista, para titular la pantalla con su nombre. */
  protected readonly priceList = signal<PriceListDto | null>(null);

  protected readonly paginator = new MatTablePaginator<PriceListProductDto>({
    fetchData: (query) => this.priceListsApi.paginateProducts(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 't', columna: 'name' },
      { tabla: 't', columna: 'sku' },
      { tabla: 't', columna: 'barcode' },
    ],
    // Los JOIN sólo se emiten cuando un filtro u orden nombra la tabla, así que declararlos siempre
    // no cuesta nada en el listado sin filtrar.
    relaciones: [
      {
        tipo: 'left',
        desdeTabla: 't',
        desdeColumna: 'id_brand',
        hastaTabla: 'brands',
        hastaColumna: 'id',
      },
      {
        tipo: 'left',
        desdeTabla: 't',
        desdeColumna: 'id_category',
        hastaTabla: 'categories',
        hastaColumna: 'id',
      },
    ],
    // El precio no se puede ordenar: vive en `price_list_prices`, y el JOIN que haría falta
    // multiplicaría la fila del producto por sus listas. Se ordena por lo que identifica al producto.
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      sku: { tabla: 't', columna: 'sku' },
      brand: { tabla: 'brands', columna: 'name' },
      category: { tabla: 'categories', columna: 'name' },
    },
    filterConfig: {
      brand: { tabla: 'brands', columna: 'uuid' },
      category: { tabla: 'categories', columna: 'uuid' },
      type: { tabla: 't', columna: 'type' },
    },
  });

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly brands = signal<readonly UuidNameRef[]>([]);
  protected readonly categories = signal<readonly PickerCategoryOption[]>([]);

  protected readonly brandFilter = signal<string | null>(null);
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly typeFilter = signal<ProductType | null>(null);

  protected readonly productTypes = PRODUCT_TYPES;
  protected readonly filtersOpen = signal(false);
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  /** El título dice de qué lista son estos precios; mientras no llegó, el nombre genérico. */
  protected readonly title = computed(() => {
    this.language.currentLang();

    const name = this.priceList()?.name;
    return name
      ? this.translate.instant('priceLists.prices.titleNamed', { name })
      : this.translate.instant('priceLists.prices.title');
  });

  protected readonly displayedColumns = computed(() => [
    'name',
    'sku',
    'brand',
    'category',
    'price',
    ...(this.rowActions().length > 0 ? ['actions'] : []),
  ]);

  /** Sin ninguno de los dos permisos no hay acciones, así que la columna directamente no se arma. */
  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(PRODUCT_EDIT_PERMISSION)) {
      actions.push({
        id: 'editPrices',
        icon: 'edit',
        label: this.translate.instant('priceLists.prices.actions.editPrices'),
      });
    }

    if (this.auth.hasPermission(PRICE_HISTORY_VIEW_PERMISSION)) {
      actions.push({
        id: 'viewHistory',
        icon: 'timeline',
        label: this.translate.instant('priceLists.prices.actions.viewHistory'),
      });
    }

    return actions;
  });

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => {
      this.language.currentLang();

      const name = this.priceList()?.name;
      return [
        BREADCRUMB_HOME,
        { labelKey: 'nav.items.priceLists', link: PRICE_LISTS_PATHS },
        name
          ? { label: name, link: priceListPricesPath(this.priceListUuid) }
          : { labelKey: 'priceLists.prices.title' },
      ];
    });
  }

  ngOnInit(): void {
    this.loadPriceList();
    this.loadFilterOptions();

    const params = this.route.snapshot.queryParams;
    if (Object.keys(params).length > 0) {
      this.paginator.applyQueryParams(params);
      this.restoreFilterSelection();
    } else {
      this.paginator.load();
    }
  }

  /** Precio del producto en **esta** lista, o `null` si no lo cotiza. */
  protected priceOf(product: PriceListProductDto): number | null {
    return priceFor(product, this.priceListUuid);
  }

  protected onBack(): void {
    void this.router.navigate([PRICE_LISTS_PATHS]);
  }

  protected onRowAction(actionId: string, product: PriceListProductDto): void {
    if (actionId === 'editPrices') {
      void this.router.navigate([productPricingPath(product.uuid)], {
        queryParams: { tab: PRODUCT_PRICING_TAB },
      });
      return;
    }

    if (actionId === 'viewHistory') {
      void this.router.navigate([productPriceHistoryPath(product.uuid)]);
    }
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

  protected onBrandChange(uuid: string | null): void {
    this.brandFilter.set(uuid);
    this.applyFilters();
  }

  protected onCategoryChange(uuid: string | null): void {
    this.categoryFilter.set(uuid);
    this.applyFilters();
  }

  protected onTypeChange(type: ProductType | null): void {
    this.typeFilter.set(type);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.brandFilter.set(null);
    this.categoryFilter.set(null);
    this.typeFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const brandUuid = this.brandFilter();
    if (brandUuid) {
      filters['brand'] = { value: brandUuid, matchMode: FilterMatchMode.Equals };
    }

    const categoryUuid = this.categoryFilter();
    if (categoryUuid) {
      // Filtrar por una categoría incluye su subárbol: elegir "Bebidas" trae también las de
      // "Bebidas / Gaseosas". El uuid elegido va primero para poder restaurar el select desde la URL.
      filters['category'] = {
        value: this.subtreeUuids(categoryUuid),
        matchMode: FilterMatchMode.In,
      };
    }

    const type = this.typeFilter();
    if (type) {
      filters['type'] = { value: type, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  private subtreeUuids(categoryUuid: string): string[] {
    const option = this.categories().find((item) => item.uuid === categoryUuid);
    return option ? option.subtreeUuids : [categoryUuid];
  }

  /** Repuebla los selects con los filtros que el paginador restauró desde la URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const brand = firstConstraint(filters['brand']);
    this.brandFilter.set(typeof brand?.value === 'string' ? brand.value : null);

    const categoryValue = firstConstraint(filters['category'])?.value;
    this.categoryFilter.set(
      Array.isArray(categoryValue)
        ? ((categoryValue[0] as string) ?? null)
        : typeof categoryValue === 'string'
          ? categoryValue
          : null,
    );

    const type = firstConstraint(filters['type'])?.value;
    this.typeFilter.set(PRODUCT_TYPES.find((option) => option === type) ?? null);

    // Con un filtro puesto el panel tiene que abrirse solo: si no, el link compartido llega
    // filtrado y sin nada que explique por qué faltan filas.
    this.filtersOpen.set(
      this.brandFilter() !== null || this.categoryFilter() !== null || this.typeFilter() !== null,
    );
  }

  /**
   * El encabezado de la lista es sólo para titular: si falla, la grilla igual sirve —los precios
   * salen del producto—, así que se avisa y se sigue con el título genérico en vez de vaciar la
   * pantalla.
   */
  private loadPriceList(): void {
    if (!this.priceListUuid) {
      return;
    }

    this.priceListsApi
      .getByUuid(this.priceListUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (priceList) => this.priceList.set(priceList),
        error: () => this.toast.error(this.translate.instant('priceLists.prices.toasts.listError')),
      });
  }

  private loadFilterOptions(): void {
    this.priceListsApi
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brands) => this.brands.set(brands),
        error: () =>
          this.toast.error(this.translate.instant('priceLists.prices.toasts.brandsError')),
      });

    this.priceListsApi
      .getCategoryOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: () =>
          this.toast.error(this.translate.instant('priceLists.prices.toasts.categoriesError')),
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
