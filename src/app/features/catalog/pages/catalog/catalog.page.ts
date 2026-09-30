import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FilterMatchMode, PaginationFilterConstraint } from '../../../../core/paginate';
import { ProductPickerApiService } from '../../../../core/product-picker/product-picker-api.service';
import {
  PickerCategoryOption,
  PickerUuidNameRef,
} from '../../../../core/product-picker/product-picker.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { CATALOG_PATH } from '../../catalog.paths';
import {
  CATALOG_DEFAULT_SORT_PARAM,
  createCatalogPaginator,
} from '../../data-access/catalog-list.query';

/**
 * El catálogo de solo lectura: lo que ve del producto quien no administra el catálogo.
 *
 * Se abre con `product.view` —el cliente del portal, el vendedor, el transportista— y lista los productos
 * de la sucursal activa con lo que el backend le deja ver a cada uno. Sin precios: el cliente del portal
 * no cotiza desde acá. El saldo sí, para quien opera el stock (`stock.view`): a quien no, el backend se lo
 * manda en `null` y la columna ni se dibuja.
 *
 * No hay alta ni edición: eso es la pantalla de productos, que exige administrar el catálogo y se le esconde
 * a quien no puede.
 */
@Component({
  selector: 'app-catalog-page',
  imports: [
    DecimalPipe,
    MatFormFieldModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [ProductPickerApiService],
  templateUrl: './catalog.page.html',
  styleUrl: './catalog.page.css',
})
export class CatalogPage implements OnInit {
  private readonly api = inject(ProductPickerApiService);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly paginator = createCatalogPaginator((query) => this.api.paginate(query));

  /** El saldo es de quien opera el stock; al resto el backend se lo manda vacío y la columna sobra. */
  protected readonly canSeeStock = this.auth.hasPermission(Permissions.stockView);

  protected readonly displayedColumns = [
    'name',
    'brand',
    'category',
    'unit',
    ...(this.canSeeStock ? ['stock'] : []),
  ];

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly brands = signal<readonly PickerUuidNameRef[]>([]);
  protected readonly categories = signal<readonly PickerCategoryOption[]>([]);

  protected readonly brandFilter = signal<string | null>(null);
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);

  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.catalog', link: CATALOG_PATH },
    ]);
  }

  ngOnInit(): void {
    this.loadFilterOptions();

    // El orden por defecto entra como un query param más para que lo pise el de la URL si lo hay.
    const params: Params = {
      sort: CATALOG_DEFAULT_SORT_PARAM,
      ...this.route.snapshot.queryParams,
    };
    this.paginator.applyQueryParams(params);
    this.restoreFilterSelection();
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

  protected onClearFilters(): void {
    this.brandFilter.set(null);
    this.categoryFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const brandUuid = this.brandFilter();
    if (brandUuid) {
      filters['brand'] = { value: brandUuid, matchMode: FilterMatchMode.Equals };
    }

    // Elegir una categoría es elegir su rama entera: el filtro viaja con la categoría y sus descendientes.
    const categoryUuid = this.categoryFilter();
    const category = this.categories().find((option) => option.uuid === categoryUuid);
    if (category) {
      filters['category'] = { value: category.subtreeUuids, matchMode: FilterMatchMode.In };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /** Re-hydrates the selects from the filters the paginator restored from the URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const brand = firstConstraint(filters['brand']);
    this.brandFilter.set(typeof brand?.value === 'string' ? brand.value : null);

    // La rama viaja como lista y su raíz va primera: es la categoría que se eligió.
    const category = firstConstraint(filters['category']);
    const root = Array.isArray(category?.value) ? category.value[0] : category?.value;
    this.categoryFilter.set(typeof root === 'string' ? root : null);

    this.filtersOpen.set(this.brandFilter() !== null || this.categoryFilter() !== null);
  }

  /**
   * Los catálogos de los selects. Que fallen no rompe el listado —que ya se está pidiendo aparte—,
   * así que sólo se avisa: la pantalla sigue sirviendo para buscar y paginar.
   */
  private loadFilterOptions(): void {
    this.api
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brands) => this.brands.set(brands),
        error: () => this.toast.error(this.translate.instant('catalog.toasts.brandsError')),
      });

    this.api
      .getCategoryOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: () => this.toast.error(this.translate.instant('catalog.toasts.categoriesError')),
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
