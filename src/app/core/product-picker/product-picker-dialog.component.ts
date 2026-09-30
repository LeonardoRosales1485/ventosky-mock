import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CurrencyDisplayComponent } from '../../shared/components/currency-display/currency-display.component';
import { LoadState } from '../../shared/components/load-state/load-state.model';
import { TableToolbarComponent } from '../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../shared/components/table-wrapper/table-wrapper.component';
import { ToastService } from '../notifications/toast.service';
import {
  FilterMatchMode,
  MatTablePaginator,
  PaginationFilterConstraint,
} from '../paginate';
import { ProductPickerApiService } from './product-picker-api.service';
import {
  PickerCategoryOption,
  PickerProduct,
  PickerUuidNameRef,
  ProductPickerDialogData,
  SUPPLIER_PICKER_RELATIONS,
  availabilityFilterGroups,
  pickerPriceFor,
} from './product-picker.model';

/** Columnas fijas, en orden; las de precio se intercalan antes de `stock`. */
const BASE_COLUMNS = ['name', 'sku', 'brand', 'category'] as const;

/** Claves con las que el paginador nombra las dos condiciones del filtro por proveedor. */
const SUPPLIER_FILTER_KEY = 'supplier';
const SUPPLIER_LINK_STATUS_FILTER_KEY = 'supplierLinkStatus';

/**
 * Selector de productos: la búsqueda por nombre, marca y categoría que un campo de código de barras
 * no puede dar. Devuelve la fila entera del paginado operativo —con stock y precios de la sucursal
 * activa— para que quien lo abrió no tenga que volver a pedirla.
 *
 * Trae sus propios catálogos y su propio paginado porque sólo hacen falta mientras está abierto, y
 * vive en `core/` a propósito: lo usa el mostrador hoy, y compras o transferencias mañana, sin que
 * una pantalla tenga que importar componentes de otra.
 */
@Component({
  selector: 'app-product-picker-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [ProductPickerApiService],
  templateUrl: './product-picker-dialog.component.html',
  styleUrl: './product-picker-dialog.component.css',
})
export class ProductPickerDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<ProductPickerDialogComponent, PickerProduct>,
  );
  private readonly api = inject(ProductPickerApiService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<ProductPickerDialogData>(MAT_DIALOG_DATA);

  protected readonly paginator = new MatTablePaginator<PickerProduct>({
    fetchData: (query) => this.api.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 't', columna: 'name' },
      { tabla: 't', columna: 'sku' },
      { tabla: 't', columna: 'barcode' },
    ],
    // Los JOIN sólo se emiten cuando un filtro u orden nombra la tabla, así que declararlos
    // siempre no cuesta nada mientras nadie filtre por marca o categoría.
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
      // El vínculo producto↔proveedor. Es INNER: cuando el filtro está puesto, un producto que ese
      // proveedor no provee no tiene que pasar.
      ...SUPPLIER_PICKER_RELATIONS,
    ],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      sku: { tabla: 't', columna: 'sku' },
      brand: { tabla: 'brands', columna: 'name' },
      category: { tabla: 'categories', columna: 'name' },
    },
    filterConfig: {
      brand: { tabla: 'brands', columna: 'uuid' },
      category: { tabla: 'categories', columna: 'uuid' },
      [SUPPLIER_FILTER_KEY]: { tabla: 'party_roles', columna: 'uuid' },
      [SUPPLIER_LINK_STATUS_FILTER_KEY]: { tabla: 'product_suppliers', columna: 'status' },
    },
    presetFilterGroups: availabilityFilterGroups(this.data.availability, this.data.trackedOnly),
  });

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;

  protected readonly searchQuery = signal(this.data.initialSearch?.trim() ?? '');

  protected readonly brands = signal<readonly PickerUuidNameRef[]>([]);
  protected readonly categories = signal<readonly PickerCategoryOption[]>([]);

  protected readonly brandFilter = signal<string | null>(null);
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);

  /**
   * Si el catálogo está acotado al proveedor de la compra. Arranca puesto cuando quien abrió el
   * selector pasó uno, y se puede sacar desde acá: el vínculo es un dato del producto, no una regla
   * de la compra, y el operador que tiene el remito en la mano manda sobre lo que esté cargado.
   */
  protected readonly supplierFilter = signal(this.data.supplier !== undefined);

  /**
   * Cuántos filtros hay puestos, para el badge de la barra. El status del vínculo no cuenta:
   * acompaña al del proveedor —es la misma decisión— y contarlo diría dos donde el usuario eligió
   * una sola cosa.
   */
  protected readonly activeFilters = computed(
    () =>
      Object.keys(this.paginator.filters()).filter((key) => key !== SUPPLIER_LINK_STATUS_FILTER_KEY)
        .length,
  );

  protected readonly displayedColumns = computed(() => [
    ...BASE_COLUMNS,
    ...this.data.priceLists.map((list) => priceColumnId(list.uuid)),
    'stock',
    'actions',
  ]);

  protected readonly LoadState = LoadState;
  protected readonly priceColumnId = priceColumnId;

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.paginator.setGlobalFilter(value));

    this.loadFilterOptions();

    // Una sola lectura al abrir, con todo puesto: el término que venía de afuera —para no mostrar
    // un listado sin filtrar que nadie llegaría a ver— y el filtro por proveedor si vino uno. Por
    // separado serían dos consultas y un parpadeo entre ellas.
    this.paginator.handlePaginateEvent({
      ...this.paginator.getCurrentEvent(),
      pageIndex: 0,
      globalFilter: this.searchQuery(),
      filters: this.buildFilters(),
    });
  }

  protected priceOf(product: PickerProduct, priceListUuid: string): number | null {
    return pickerPriceFor(product, priceListUuid);
  }

  protected onSelect(product: PickerProduct): void {
    this.dialogRef.close(product);
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
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

  protected onSupplierFilterChange(enabled: boolean): void {
    this.supplierFilter.set(enabled);
    this.applyFilters();
  }

  /**
   * «Limpiar filtros» también saca el del proveedor: es uno más de los que la barra dice tener
   * puestos, y dejarlo activo mientras el badge vuelve a cero sería mentir sobre lo que se está
   * listando. Volver a ponerlo es un click en el panel.
   */
  protected onClearFilters(): void {
    this.brandFilter.set(null);
    this.categoryFilter.set(null);
    this.supplierFilter.set(false);
    this.paginator.clearFilters();
  }

  private applyFilters(): void {
    this.paginator.setFilters(this.buildFilters());
  }

  /** Los filtros del panel, sin efecto sobre el paginador: quien llama decide cuándo se leen. */
  private buildFilters(): Record<string, PaginationFilterConstraint> {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const brandUuid = this.brandFilter();
    if (brandUuid) {
      filters['brand'] = { value: brandUuid, matchMode: FilterMatchMode.Equals };
    }

    const categoryUuid = this.categoryFilter();
    if (categoryUuid) {
      // Elegir una categoría incluye su subárbol: "Bebidas" trae también las de "Bebidas / Gaseosas".
      filters['category'] = {
        value: this.subtreeUuids(categoryUuid),
        matchMode: FilterMatchMode.In,
      };
    }

    const supplier = this.data.supplier;
    if (supplier && this.supplierFilter()) {
      filters[SUPPLIER_FILTER_KEY] = {
        value: supplier.uuid,
        matchMode: FilterMatchMode.Equals,
      };
      // Los dos van juntos: el JOIN traería también los vínculos dados de baja.
      filters[SUPPLIER_LINK_STATUS_FILTER_KEY] = { value: 0, matchMode: FilterMatchMode.Equals };
    }

    return filters;
  }

  private subtreeUuids(categoryUuid: string): string[] {
    const option = this.categories().find((item) => item.uuid === categoryUuid);
    return option ? option.subtreeUuids : [categoryUuid];
  }

  /**
   * Marcas y categorías del panel de filtros. Si alguna falla el selector sigue sirviendo —la
   * búsqueda por texto no depende de ellas—, así que se avisa y no se bloquea.
   */
  private loadFilterOptions(): void {
    this.api
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brands) => this.brands.set(brands),
        error: () => this.toast.error(this.translate.instant('productPicker.brandsError')),
      });

    this.api
      .getCategoryOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: () => this.toast.error(this.translate.instant('productPicker.categoriesError')),
      });
  }
}

/** Material deriva la clase `mat-column-{id}` del id, así que tiene que ser válido en un selector. */
function priceColumnId(priceListUuid: string): string {
  return `price_${priceListUuid}`;
}
