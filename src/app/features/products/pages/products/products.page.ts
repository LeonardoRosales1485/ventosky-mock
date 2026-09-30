import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, filter, map, skip, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { FEATURES } from '../../../../core/features/feature-flags';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  FilterMatchMode,
  MatTablePaginator,
  PaginationData,
  PaginationFilterConstraint,
} from '../../../../core/paginate';
import { environment } from '../../../../../environments/environment';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { PRODUCTS_PATH, productEditPath } from '../../../../core/product/product-page.paths';
import {
  PRODUCT_MODEL_NEW_PATH,
  PRODUCTS_NEW_PATH,
  productModelEditPath,
} from '../../products.paths';

import {
  CategoryOption,
  PRODUCT_CREATE_PERMISSION,
  PRODUCT_DELETE_PERMISSION,
  PRODUCT_EDIT_PERMISSION,
  PRODUCT_SALE_STATUSES,
  PRODUCT_TYPES,
  ProductPaginateDto,
  ProductType,
  STOCK_TRACKING_MODES,
  ProductSaleStatus,
  DEFAULT_PRODUCT_SALE_STATUS,
  saleStatusFlagsOf,
  StockLevel,
  StockTracking,
  resolveStockLevel,
} from '../../data-access/product.model';
import { archiveConsequencesOf } from '../../data-access/product-archive';
import { ProductChip } from '../../../../shared/components/product-chip/product-chip';
import { ProductChipComponent } from '../../../../shared/components/product-chip/product-chip.component';
import { productChipsOf } from '../../data-access/product-chips';
import {
  ProductCatalogRowDto,
  ProductLeafRow,
  ProductModelGroupRow,
  ProductMoreVariantsRow,
  ProductRow,
  toRows,
} from '../../data-access/product-grouping';
import { STOCK_ADJUSTMENT_PERMISSION } from '../../data-access/stock-adjustment.model';
import { ProductsApiService } from '../../data-access/products-api.service';

/**
 * Valor de `?tab=` con el que se entra directo a la solapa Stock del formulario. Ajustar stock no
 * abre un diálogo propio: lleva a la pantalla del producto, que es donde vive el flujo completo
 * —distribución por depósito, reparto entre lotes, saldo desactualizado—.
 */
const STOCK_TAB_QUERY_VALUE = 'stock';

/**
 * Cómo viaja «todos» en la URL.
 *
 * «Todos» es la **ausencia** de filtro, así que sin una marca propia no se distingue de un link que
 * no habla de circulación —un `?q=cafe` tipeado a mano, un favorito anterior a este filtro—. Sin
 * distinguirlos hay que elegir mal en uno de los dos casos: o el link que pedía todo abre filtrado, o
 * el favorito viejo abre sin el default. Con la marca, la ausencia significa «no dice nada» y ahí
 * manda el default.
 */
const SALE_STATUS_QUERY_KEY = 'status';
const ALL_SALE_STATUS_QUERY_VALUE = 'all';

/**
 * Las columnas del listado, en orden.
 *
 * El precio **no** está: se mudó a su propia pantalla, una por lista de precio (`Ver precios` desde
 * el ABM de listas). Acá una columna por lista hacía que el ancho de la tabla dependiera de cuántas
 * listas tuviera la empresa, y la pregunta que contestaba —«¿cuánto vale esto en Mayorista?»— se
 * mira mejor recorriendo una lista entera que quince columnas de reojo.
 */
const BASE_COLUMNS = ['name', 'brand', 'category'] as const;

/** Lo que la celda de stock necesita para pintarse y para explicarse. */
interface StockBadge {
  /** Tramo del semáforo; el template lo usa como sufijo de la clase CSS. */
  level: StockLevel;
  /** El saldo, o «—» cuando el producto no lleva control de existencias. */
  value: number | string;
  /** Nombre del tramo, para que el color no sea el único canal. */
  levelLabel: string;
  tooltip: string;
  /** Etiqueta corta de la pill («Óptimo», «Sin umbrales»). */
  shortLabel: string;
  pillClass: string;
  /** Relleno de la barra (0–100) contra el stock óptimo, o `null` si no hay umbral. */
  fill: number | null;
}

const STOCK_PILL: Record<StockLevel, string> = {
  optimal: 'vk-pill--ok',
  belowOptimal: 'vk-pill--warn',
  low: 'vk-pill--warn',
  out: 'vk-pill--bad',
  unknown: '',
  notTracked: '',
};

@Component({
  selector: 'app-products-page',
  imports: [
    MatButtonToggleModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
    ProductChipComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [ProductsApiService],
  templateUrl: './products.page.html',
  styleUrl: './products.page.css',
})
export class ProductsPage implements OnInit {
  private readonly productsApi = inject(ProductsApiService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);

  protected readonly canCreate = this.auth.hasPermission(PRODUCT_CREATE_PERMISSION);

  /**
   * El modelo se da de alta desde acá porque es donde el usuario descubre que le faltan variantes:
   * el permiso es el del modelo, no el del producto, así que los dos botones aparecen por separado.
   */
  protected readonly canCreateModel =
    FEATURES.productModels && this.auth.hasPermission(Permissions.productModelCreate);

  /**
   * Un solo paginador para los dos modos, siempre sobre la **fila del catálogo**.
   *
   * En plano cada producto se envuelve como una fila `PRODUCT`, así el contador, la búsqueda y los
   * filtros son los mismos en los dos modos y no hay dos paginadores que sincronizar. Es también lo
   * que hace que «1 – 10 de 22» signifique lo que el usuario ve: filas, no variantes escondidas.
   */
  protected readonly paginator = new MatTablePaginator<ProductCatalogRowDto>({
    fetchData: (query) =>
      this.flatView()
        ? this.productsApi.paginate(query).pipe(map(toFlatCatalogPage))
        : this.productsApi.paginateCatalog(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 't', columna: 'name' },
      { tabla: 't', columna: 'sku' },
      { tabla: 't', columna: 'barcode' },
    ],
    // Los JOIN sólo se emiten cuando un filtro u orden nombra la tabla, así que declararlos
    // siempre no cuesta nada en el listado sin filtrar.
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
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      sku: { tabla: 't', columna: 'sku' },
      brand: { tabla: 'brands', columna: 'name' },
      category: { tabla: 'categories', columna: 'name' },
    },
    filterConfig: {
      brand: { tabla: 'brands', columna: 'uuid' },
      category: { tabla: 'categories', columna: 'uuid' },
      // Los dos ejes viven en la fila del producto, así que filtran sin sumar un JOIN.
      type: { tabla: 't', columna: 'type' },
      stockTracking: { tabla: 't', columna: 'stock_tracking' },
      // Las dos banderas de circulación. Son claves separadas porque «discontinuado» las pide a las
      // dos apagadas a la vez, y el paginador combina con AND lo que viene en claves distintas.
      forSale: { tabla: 't', columna: 'is_for_sale' },
      forPurchase: { tabla: 't', columna: 'is_for_purchase' },
    },
  });

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly brands = signal<readonly { uuid: string; name: string }[]>([]);
  protected readonly categories = signal<readonly CategoryOption[]>([]);

  protected readonly brandFilter = signal<string | null>(null);
  protected readonly categoryFilter = signal<string | null>(null);

  /*
   * Los ejes del producto como filtro (§4, wireframe `1a`). Son la forma de contestar «¿cuáles
   * llevan lote?» sin recorrer el catálogo: la pregunta que aparece justo cuando los ejes dejan de
   * ser todos iguales.
   */
  protected readonly typeFilter = signal<ProductType | null>(null);
  protected readonly stockTrackingFilter = signal<StockTracking | null>(null);

  /*
   * El estado de circulación (§2 de VTY-484). Arranca en `onSale` y no en «todos» porque el listado
   * sin filtro es el problema que el archivado y la discontinuación vinieron a resolver: lo que se
   * dejó de vender no tiene por qué seguir ocupando la primera página.
   *
   * La URL manda sobre el default: si el link trae filtros, se restaura lo que trae —«Todos» incluido,
   * que viaja como la ausencia de los dos— y el link compartido llega filtrado como lo dejó quien lo
   * mandó.
   */
  protected readonly saleStatusFilter = signal<ProductSaleStatus | null>(
    DEFAULT_PRODUCT_SALE_STATUS,
  );

  protected readonly productTypes = PRODUCT_TYPES;
  protected readonly stockTrackingModes = STOCK_TRACKING_MODES;
  protected readonly saleStatuses = PRODUCT_SALE_STATUSES;

  protected readonly filtersOpen = signal(false);

  /**
   * Cuántos **controles** del panel están puestos, que no es lo mismo que cuántas condiciones viajan:
   * «discontinuado» pide las dos banderas apagadas desde un solo select, y contar las condiciones
   * diría que hay un filtro puesto que el usuario no ve por ningún lado.
   *
   * El estado de circulación cuenta aunque sea el default: hay filas que no se están mostrando, y un
   * contador en cero mientras faltan filas es justo lo que deja al usuario sin explicación.
   */
  protected readonly activeFilters = computed(
    () =>
      [
        this.brandFilter(),
        this.categoryFilter(),
        this.typeFilter(),
        this.stockTrackingFilter(),
        this.saleStatusFilter(),
      ].filter((value) => value !== null).length,
  );

  /*
   * Agrupación por modelo (§5.6, wireframe `1a`).
   *
   * Doce variantes que inundan el listado son peores que doce productos sueltos, así que el modelo
   * colapsa a una fila. La agrupación la hace **el backend**: la unidad de la página es la fila del
   * catálogo, no el producto. Hacerla acá partía un modelo de dieciséis variantes entre páginas y lo
   * repetía en cada una.
   *
   * `flat` devuelve la vista plana de siempre: nadie pierde el listado que ya conoce.
   */
  protected readonly flatView = signal(readFlagParam(this.route.snapshot.queryParams['flat']));
  private readonly expandedModels = signal<ReadonlySet<string>>(new Set());
  private readonly loadingModels = signal<ReadonlySet<string>>(new Set());

  /** Las variantes ya pedidas, por modelo. Se cargan al expandir y se recuerdan. */
  private readonly variantsByModel = signal<ReadonlyMap<string, readonly ProductPaginateDto[]>>(
    new Map(),
  );

  /**
   * Las filas que se dibujan. En plano son los productos tal cual; agrupadas, la página del catálogo
   * con las variantes de los modelos expandidos debajo de su fila.
   */
  protected readonly rows = computed<ProductRow[]>(() =>
    toRows(
      this.paginator.items(),
      this.expandedModels(),
      this.variantsByModel(),
      this.loadingModels(),
    ),
  );

  /** Sin ninguno de los dos permisos no hay acciones, así que la columna directamente no se arma. */
  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(PRODUCT_EDIT_PERMISSION)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('products.actions.edit'),
      });
    }

    if (this.auth.hasPermission(STOCK_ADJUSTMENT_PERMISSION)) {
      actions.push({
        id: 'adjustStock',
        icon: 'inventory_2',
        label: this.translate.instant('products.actions.adjustStock'),
      });
    }

    /*
     * **Archivar**, y no «dar de baja»: la palabra que nombra a las dos operaciones está prohibida
     * en el proyecto (ADR 0001). Discontinuar no está acá porque no es lo mismo ni se deshace
     * igual — vive en la ficha, que es donde ya se prenden y apagan las dos banderas.
     */
    if (this.auth.hasPermission(PRODUCT_DELETE_PERMISSION)) {
      actions.push({
        id: 'archive',
        icon: 'archive',
        label: this.translate.instant('products.actions.archive'),
        color: 'warn',
      });
    }

    return actions;
  });

  /**
   * Lo que se puede hacer sobre la fila de un modelo: **sólo editarlo**, y con su propio permiso.
   *
   * No comparte las acciones del producto porque no comparte nada de lo que hacen: el modelo no
   * tiene saldo que ajustar (RN-12) y su ficha no es el formulario de producto sino la de la matriz.
   */
  protected readonly modelRowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    if (!FEATURES.productModels || !this.auth.hasPermission(Permissions.productModelEdit)) {
      return [];
    }

    return [
      {
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('products.actions.editModel'),
      },
    ];
  });

  protected readonly displayedColumns = computed(() => [
    ...BASE_COLUMNS,
    'stock',
    // La columna se arma si alguna de las dos filas tiene algo que ofrecer: con permiso sobre el
    // modelo y no sobre el producto, el lápiz del modelo tiene que seguir teniendo dónde dibujarse.
    ...(this.rowActions().length > 0 || this.modelRowActions().length > 0 ? ['actions'] : []),
  ]);

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => {
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.products', link: PRODUCTS_PATH }];
    });
  }

  ngOnInit(): void {
    this.loadFilterOptions();

    const params = this.route.snapshot.queryParams;
    if (Object.keys(params).length === 0) {
      // `load()` traería el catálogo entero: la primera carga también pasa por los filtros, porque
      // el estado de circulación arranca con uno puesto.
      this.applyFilters();
      return;
    }

    this.paginator.applyQueryParams(params);
    if (this.restoreFilterSelection(params)) {
      // El link no dice nada de la circulación —es anterior al filtro, o lo escribió alguien a
      // mano—, así que se le aplica el default. Cuesta una segunda consulta, y sólo en ese caso: un
      // link hecho por esta pantalla siempre dice cuál de los tres estados quiso.
      this.applyFilters();
    }
  }

  /**
   * El color solo no dice qué margen se perforó y los umbrales no tienen columna propia, así que
   * el tooltip los nombra: sin eso hay que abrir el producto para saber por qué está en rojo.
   */
  protected stockBadge(product: ProductPaginateDto): StockBadge {
    const level = resolveStockLevel(product);
    // Sin control de existencias no hay número que mostrar: la celda dice que no aplica.
    const value = level === 'notTracked' ? '—' : (product.totalStock ?? 0);
    const levelLabel = this.translate.instant(`products.stock.levels.${level}`);
    const notSet = this.translate.instant('products.stock.noThreshold');
    const hasThresholds = product.lowStock != null || product.optimalStock != null;

    const thresholds = hasThresholds
      ? this.translate.instant('products.stock.thresholds', {
          low: product.lowStock ?? notSet,
          optimal: product.optimalStock ?? notSet,
        })
      : '';

    const optimal = product.optimalStock ?? product.lowStock ?? null;
    const fill =
      level === 'notTracked' || optimal == null || optimal <= 0
        ? null
        : Math.max(0, Math.min(100, ((product.totalStock ?? 0) / optimal) * 100));

    return {
      level,
      value,
      levelLabel,
      tooltip: hasThresholds ? `${levelLabel} · ${thresholds}` : levelLabel,
      shortLabel: this.translate.instant(`products.stock.short.${level}`),
      pillClass: STOCK_PILL[level],
      fill,
    };
  }

  /** El ícono del thumb: dice qué es el producto antes de leer el nombre. */
  protected thumbIcon(product: ProductPaginateDto): string {
    if (product.type === 'KIT') {
      return 'widgets';
    }
    if (product.type === 'SERVICE') {
      return 'handyman';
    }
    if (product.isWeighable) {
      return 'scale';
    }
    return 'inventory_2';
  }

  /** Importar todavía no existe: en el mock se avisa en vez de esconder el botón. */
  protected onImport(): void {
    this.toast.info(this.translate.instant('products.import.comingSoon'));
  }

  /** Los chips de los ejes que la fila muestra al lado del nombre. */
  protected chipsOf(product: ProductPaginateDto): ProductChip[] {
    return productChipsOf(product);
  }

  protected onCreate(): void {
    void this.router.navigate([PRODUCTS_NEW_PATH]);
  }

  protected onCreateModel(): void {
    void this.router.navigate([PRODUCT_MODEL_NEW_PATH]);
  }

  /** El modelo se edita en su propia pantalla; desde acá sólo se llega. */
  protected onModelRowAction(actionId: string, model: ProductModelGroupRow): void {
    if (actionId === 'edit') {
      this.openModel(model.uuid);
    }
  }

  /**
   * El pie «…N variantes más» va a la ficha del modelo y no estira la fila.
   *
   * Seguir desplegando devolvía el problema que la agrupación vino a resolver: dieciséis variantes
   * abiertas son la página entera. La ficha es la pantalla que ya las muestra todas —y las deja
   * editar—, así que el pie lleva ahí en vez de duplicarla en el listado.
   */
  protected onOpenMoreVariants(row: ProductMoreVariantsRow): void {
    // Con los modelos apagados no hay ficha a la que ir: la vista plana es la que las muestra todas.
    if (!FEATURES.productModels) {
      this.onToggleFlatView(true);
      return;
    }
    this.openModel(row.modelUuid);
  }

  private openModel(modelUuid: string): void {
    void this.router.navigate([productModelEditPath(modelUuid)]);
  }

  /**
   * Material elige la plantilla de cada fila con estos predicados. El pie ocupa el ancho de la
   * tabla, así que no puede compartir las columnas del resto.
   */
  protected readonly isMoreVariantsRow = (_index: number, row: ProductRow): boolean =>
    row.kind === 'moreVariants';

  protected onRowAction(actionId: string, row: ProductLeafRow): void {
    const product = row.product;

    if (actionId === 'edit') {
      void this.router.navigate([productEditPath(product.uuid)]);
      return;
    }

    if (actionId === 'adjustStock') {
      void this.router.navigate([productEditPath(product.uuid)], {
        queryParams: { tab: STOCK_TAB_QUERY_VALUE },
      });
      return;
    }

    if (actionId === 'archive') {
      this.archiveProduct(row);
    }
  }

  /**
   * Archiva el producto, con un diálogo que dice **qué se pierde** y no sólo qué se va.
   *
   * El listado es la única pantalla donde el usuario ve la regla de los códigos, y archivar no se
   * deshace: confirmar con el nombre solo es pedirle que apruebe algo que no puede evaluar. Las
   * consecuencias las arma {@link archiveConsequencesOf}, que decide cuáles aplican.
   */
  private archiveProduct(row: ProductLeafRow): void {
    const product = row.product;
    const consequences = archiveConsequencesOf(product)
      .map((line) => this.translate.instant(line.labelKey, line.params))
      .join('\n');

    this.confirmDialog
      .confirm({
        title: this.translate.instant('products.archive.title'),
        message: `${this.translate.instant('products.archive.question', { name: product.name })}\n\n${consequences}`,
        confirmLabel: this.translate.instant('products.actions.archive'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.productsApi.delete(product.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(
            this.translate.instant('products.toasts.archived', { name: product.name }),
          );
          this.relocateAfterArchiving(row);
          // Lo expandido se olvida: las variantes que quedaron en memoria incluyen a la que ya no
          // está, y dejar el modelo abierto contra una lista vacía diría que se quedó sin ninguna.
          this.expandedModels.set(new Set());
          this.variantsByModel.set(new Map());
          void this.syncQueryParams();
        },
        error: (error: unknown) => {
          /*
           * El componente de un kit vivo no se archiva: el combo quedaría explotando contra
           * mercadería que el catálogo ya no ofrece. El backend manda el nombre del kit en el
           * `userMessage`, así que la salida —sacarlo de la composición primero— se lee sin abrir
           * ninguna otra pantalla.
           */
          const fallback = hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_IN_USE_BY_KIT)
            ? 'products.toasts.archiveInUseByKit'
            : 'products.toasts.archiveError';
          this.toast.error(resolveApiErrorMessage(error, this.translate.instant(fallback)));
        },
      });
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

  protected onStockTrackingChange(tracking: StockTracking | null): void {
    this.stockTrackingFilter.set(tracking);
    this.applyFilters();
  }

  protected onSaleStatusChange(status: ProductSaleStatus | null): void {
    this.saleStatusFilter.set(status);
    // Las variantes que ya se pidieron salieron con el estado anterior: dejarlas en memoria haría
    // que un modelo expandido siguiera mostrando lo que el filtro nuevo acaba de sacar de la lista.
    this.variantsByModel.set(new Map());
    this.expandedModels.set(new Set());
    this.applyFilters();
  }

  /**
   * «Limpiar» devuelve el listado a como abre, no a «todos»: el default es parte del filtro, y
   * dejarlo en «todos» convertiría el botón en la forma más rápida de volver a ver el catálogo lleno
   * de productos que ya no se venden.
   */
  protected onClearFilters(): void {
    this.brandFilter.set(null);
    this.categoryFilter.set(null);
    this.typeFilter.set(null);
    this.stockTrackingFilter.set(null);
    this.saleStatusFilter.set(DEFAULT_PRODUCT_SALE_STATUS);
    this.applyFilters();
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

    const stockTracking = this.stockTrackingFilter();
    if (stockTracking) {
      filters['stockTracking'] = { value: stockTracking, matchMode: FilterMatchMode.Equals };
    }

    // La regla de qué bandera pide cada estado vive en `saleStatusFlagsOf`, porque la consulta de
    // variantes de un modelo necesita la misma y escrita dos veces se desincronizaba.
    for (const flag of saleStatusFlagsOf(this.saleStatusFilter())) {
      filters[flag.filterKey] = { value: flag.value, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  private subtreeUuids(categoryUuid: string): string[] {
    const option = this.categories().find((item) => item.uuid === categoryUuid);
    return option ? option.subtreeUuids : [categoryUuid];
  }

  /**
   * Repuebla los selects con los filtros que el paginador restauró de la URL.
   *
   * Devuelve `true` cuando el link **no dice nada** del estado de circulación: ahí la pantalla tiene
   * que aplicar el default por su cuenta, porque el paginador ya cargó sin él.
   */
  private restoreFilterSelection(params: Params): boolean {
    const filters = this.paginator.filters();

    const brand = firstConstraint(filters['brand']);
    this.brandFilter.set(typeof brand?.value === 'string' ? brand.value : null);

    const category = firstConstraint(filters['category']);
    const categoryValue = category?.value;
    this.categoryFilter.set(
      Array.isArray(categoryValue)
        ? ((categoryValue[0] as string) ?? null)
        : typeof categoryValue === 'string'
          ? categoryValue
          : null,
    );

    const type = firstConstraint(filters['type'])?.value;
    this.typeFilter.set(PRODUCT_TYPES.find((option) => option === type) ?? null);

    const stockTracking = firstConstraint(filters['stockTracking'])?.value;
    this.stockTrackingFilter.set(
      STOCK_TRACKING_MODES.find((option) => option === stockTracking) ?? null,
    );

    /*
     * «Todos» y «el link no habla de circulación» son la misma ausencia de filtro, así que se
     * distinguen por la marca explícita: con ella el estado es «todos», y sin ella ni `forSale` el
     * link es anterior al filtro y manda el default.
     */
    const forSale = firstConstraint(filters['forSale'])?.value;
    const saysAll = params[SALE_STATUS_QUERY_KEY] === ALL_SALE_STATUS_QUERY_VALUE;
    const saysNothing = typeof forSale !== 'boolean' && !saysAll;
    this.saleStatusFilter.set(
      saysNothing ? DEFAULT_PRODUCT_SALE_STATUS : forSale === true ? 'onSale' : forSale === false ? 'discontinued' : null,
    );

    // Con un filtro puesto el panel tiene que abrirse solo: si no, el link compartido llega
    // filtrado y sin nada que explique por qué faltan filas.
    this.filtersOpen.set(
      this.brandFilter() !== null ||
        this.categoryFilter() !== null ||
        this.typeFilter() !== null ||
        this.stockTrackingFilter() !== null ||
        // El default no cuenta: abrir el panel solo en cada carga sería ruido, no explicación.
        this.saleStatusFilter() !== DEFAULT_PRODUCT_SALE_STATUS,
    );

    return saysNothing;
  }

  private loadFilterOptions(): void {
    this.productsApi
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brands) => this.brands.set(brands),
        error: () => this.toast.error(this.translate.instant('products.toasts.brandsError')),
      });

    this.productsApi
      .getCategoryOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => this.categories.set(categories),
        error: () => this.toast.error(this.translate.instant('products.toasts.categoriesError')),
      });
  }

  protected isExpanded(modelUuid: string): boolean {
    return this.expandedModels().has(modelUuid);
  }

  /**
   * Expandir un modelo pide **todas** sus variantes, no las de la página: quien expande lo hace para
   * verlas todas, y darle sólo las que cayeron en la página era justamente el defecto. Se piden una
   * vez y se recuerdan, así volver a abrirlo no cuesta otra consulta.
   */
  protected onToggleModel(modelUuid: string): void {
    const wasExpanded = this.expandedModels().has(modelUuid);
    this.expandedModels.update((expanded) => {
      const next = new Set(expanded);
      if (wasExpanded) {
        next.delete(modelUuid);
      } else {
        next.add(modelUuid);
      }
      return next;
    });

    if (wasExpanded || this.variantsByModel().has(modelUuid)) {
      return;
    }
    this.loadingModels.update((loading) => new Set(loading).add(modelUuid));
    this.productsApi
      .variantsOfModel(modelUuid, this.saleStatusFilter())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (variants) => {
          this.variantsByModel.update((byModel) => new Map(byModel).set(modelUuid, variants));
          this.clearLoading(modelUuid);
        },
        error: () => {
          this.clearLoading(modelUuid);
          // Se colapsa: una fila expandida y vacía diría que el modelo no tiene variantes.
          this.expandedModels.update((expanded) => {
            const next = new Set(expanded);
            next.delete(modelUuid);
            return next;
          });
          this.toast.error(this.translate.instant('products.grouping.variantsError'));
        },
      });
  }

  private clearLoading(modelUuid: string): void {
    this.loadingModels.update((loading) => {
      const next = new Set(loading);
      next.delete(modelUuid);
      return next;
    });
  }

  /**
   * El filtro «ver variantes sueltas». Al volver al agrupado se olvidan las expansiones: lo que
   * estaba abierto era de una lista que ya no es la que se está mirando.
   */
  protected onToggleFlatView(flat: boolean): void {
    this.flatView.set(flat);
    this.expandedModels.set(new Set());
    // Cambia la unidad de la página —filas del catálogo o productos—, así que hay que volver a la
    // primera: el offset de una no significa lo mismo en la otra.
    this.paginator.handlePaginateEvent({
      ...this.paginator.getCurrentEvent(),
      pageIndex: 0,
    });
    void this.syncQueryParams();
  }

  /**
   * Vuelve a cargar la grilla después de archivar, retrocediendo de página cuando hizo falta.
   *
   * El contador del paginador cuenta **filas del catálogo**, no productos: un modelo con doce
   * variantes es una fila sola. Archivar una variante casi nunca le quita una fila a la página —el
   * modelo sigue ahí, con once—, así que restarle uno al total y recalcular la última página haría
   * retroceder una página que no se vació. Por eso la cuenta sólo se hace cuando lo archivado era
   * una fila del catálogo: un producto suelto, o cualquier producto en la vista plana.
   */
  private relocateAfterArchiving(row: ProductLeafRow): void {
    const event = this.paginator.getCurrentEvent();

    if (row.isVariant) {
      this.paginator.handlePaginateEvent(event);
      return;
    }

    // Al archivar la última fila de la página hay que retroceder, o la grilla queda vacía.
    const nextTotal = this.paginator.totalCount() - 1;
    const lastPageIndex = Math.max(0, Math.ceil(nextTotal / this.paginator.pageSize()) - 1);
    this.paginator.handlePaginateEvent({
      ...event,
      pageIndex: Math.min(this.paginator.pageIndex(), lastPageIndex),
    });
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      // La vista plana viaja en la URL como el resto de los filtros: compartir el link comparte lo
      // que el otro va a ver.
      queryParams: {
        ...this.paginator.toQueryParams(),
        flat: this.flatView() ? '1' : null,
        // «Todos» no deja ningún filtro que serializar, así que viaja con marca propia: sin ella el
        // link se leería como uno que no habla de circulación y abriría con el default puesto.
        [SALE_STATUS_QUERY_KEY]:
          this.saleStatusFilter() === null ? ALL_SALE_STATUS_QUERY_VALUE : null,
      },
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

function readFlagParam(value: unknown): boolean {
  return value === '1' || value === 'true';
}

/**
 * La página plana como filas del catálogo: cada producto envuelto en una fila `PRODUCT`.
 *
 * Es lo que permite que los dos modos compartan paginador, contador y búsqueda. En plano no hay
 * modelos: las variantes se ven sueltas, que es exactamente lo que el filtro promete.
 */
function toFlatCatalogPage(
  page: PaginationData<ProductPaginateDto>,
): PaginationData<ProductCatalogRowDto> {
  return {
    ...page,
    content: (page.content ?? []).map((product) => ({
      rowType: 'PRODUCT' as const,
      product,
    })),
  };
}
