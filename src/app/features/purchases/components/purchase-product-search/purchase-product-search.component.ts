import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Subject,
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  skip,
  switchMap,
} from 'rxjs';
import { ToastService } from '../../../../core/notifications/toast.service';
import { ProductPickerService } from '../../../../core/product-picker/product-picker.service';
import {
  SuggestionRow,
  collapseByModel,
  suggestionKey,
} from '../../../../core/product-picker/suggestion-grouping';
import { VariantPickerService } from '../../../../core/product-picker/variant-picker.service';
import {
  PurchaseSearchMode,
  PurchaseSearchModeStore,
} from '../../data-access/purchase-search-mode.store';
import { API_ERROR_CODES, hasApiErrorCode } from '../../../../core/http/api-error.model';
import {
  PackagingRef,
  ScaleReading,
  readCarriesQuantity,
  scannedQuantityOf,
} from '../../../../core/product/product-lookup.model';
import {
  PurchaseProductDto,
  PurchaseSupplierDto,
  isKitProduct,
} from '../../data-access/purchase.model';
import {
  PRODUCT_SUGGESTION_MIN_LENGTH,
  PurchasesCatalogApiService,
} from '../../data-access/purchases-catalog-api.service';

/** Resultado de una lectura, con el código que la originó para poder explicar el error. */
interface CodeLookup {
  code: string;
  products: readonly PurchaseProductDto[];
  /**
   * Cuántas unidades base carga esa lectura: las que trae el bulto, el peso de la etiqueta de
   * balanza, o `1`. Ya viene resuelto por el backend.
   */
  quantity: number;
  /** El empaque que resolvió el código, si fue el del bulto. */
  packaging: PackagingRef | null;
  /** El desarme de la etiqueta, cuando lo que se leyó fue una. */
  scale: ScaleReading | null;
  /** Si la lectura trajo su propia cantidad. Ver {@link readCarriesQuantity}. */
  fromCode: boolean;
  /** La consulta falló (red, 500, permiso): distinto de «no hay producto con ese código». */
  failed: boolean;
}

/** Lo que sale del campo cuando entra mercadería: el producto y cuánto carga la lectura. */
export interface PurchaseProductScanned {
  product: PurchaseProductDto;
  /** Cantidad en **unidad base**. `1` en una elección de la lista, 1000 al leer un bulto. */
  quantity: number;
  packaging: PackagingRef | null;
  /**
   * Si la lectura determinó ella misma la cantidad (el peso de la etiqueta, el factor de la caja).
   * En `false` la cantidad es el «1 neutro» y el carrito puede arrancar la línea en un empaque.
   */
  quantityFromCode: boolean;
}

/** Opciones del autocompletado, con el término que las resolvió. */
interface SuggestionLookup {
  /** `null` cuando no hubo búsqueda que responder: término corto, otro modo, o consulta fallida. */
  term: string | null;
  products: readonly PurchaseProductDto[];
}

/** Cuánto se espera entre teclas antes de preguntarle al backend. */
const SUGGESTIONS_DEBOUNCE_MS = 250;

/** La tecla que alterna el modo: sola y sin modificadores, en la posición donde ya la esperan. */
const MODE_SHORTCUT = 'F2';

/**
 * El campo por el que entra la mercadería al carrito de la compra. Tiene los dos mismos modos que
 * el del mostrador, porque cargar con un lector y cargar a mano siguen siendo dos operaciones
 * distintas:
 *
 * - **Búsqueda** (`search`, el de arranque acá): lo tipeado ofrece opciones por nombre, SKU o
 *   código de barras, y el producto entra al carrito **eligiendo uno de la lista**.
 * - **Lector** (`scan`): cada Enter es una lectura de código exacto —código de barras o SKU, nunca
 *   el nombre— y el producto se agrega solo.
 *
 * El default se invierte respecto de la venta: una compra se carga leyendo el remito o la factura
 * del proveedor, no pasando la mercadería por el lector. Igual se alterna con
 * {@link MODE_SHORTCUT} o con el botón del prefijo, y la elección se recuerda — quien recibe con
 * lector en mano lo pone una vez y queda.
 *
 * El catálogo que ofrece es la mitad **comprable**: un producto marcado sólo para la venta lo
 * rechaza el commit, así que ofrecerlo sería ofrecer un error. Por el mismo motivo no ofrece
 * **kits**, en ninguno de sus dos modos: un kit es un conjunto que arma la empresa con productos
 * suyos, y lo que se le compra al proveedor son las partes.
 *
 * Con un proveedor elegido se acota además a lo que ese proveedor provee, que es lo que se está por
 * cargar en el 99 % de las compras. Es un filtro, no una regla: el botón del sufijo lo saca, y
 * entonces vuelve el catálogo comprable entero — al proveedor nuevo, o a aquel al que nadie le
 * cargó el catálogo todavía, se le compra igual. El **lector no se filtra** en ningún caso: quien
 * pasa un código tiene la mercadería en la mano, y el vínculo que falta es un dato por cargar.
 *
 * Las variantes de un modelo aparecen **colapsadas en una fila** (§5.6): el remito nombra el
 * modelo, y doce variantes que inundan la lista son doce filas que hay que leer para dar con el
 * talle. Elegir el modelo abre el selector de variante; para reponerlo entero está la carga por
 * modelo, al lado de este campo.
 *
 * Gemelo de `SaleProductSearchComponent` (`features/sales`).
 */
@Component({
  selector: 'app-purchase-product-search',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  providers: [PurchaseSearchModeStore],
  templateUrl: './purchase-product-search.component.html',
  styleUrl: './purchase-product-search.component.css',
})
export class PurchaseProductSearchComponent {
  private readonly catalogApi = inject(PurchasesCatalogApiService);
  private readonly productPicker = inject(ProductPickerService);
  private readonly variantPicker = inject(VariantPickerService);
  private readonly modeStore = inject(PurchaseSearchModeStore);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Proveedor de la compra que se está cargando, o `null` mientras no se eligió ninguno. Es lo que
   * habilita acotar el catálogo a lo que ese proveedor provee.
   */
  readonly supplier = input<PurchaseSupplierDto | null>(null);

  readonly productSelected = output<PurchaseProductScanned>();

  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly autocomplete = viewChild(MatAutocompleteTrigger);

  /** Cómo entra el producto: lectura directa o elección de una lista. */
  protected readonly mode = signal<PurchaseSearchMode>(this.modeStore.read());

  /**
   * Si el catálogo está acotado a lo que provee el proveedor elegido. Arranca puesto —es el caso
   * normal: se compra lo que ese proveedor vende— y se saca desde el propio campo, porque el
   * vínculo es un dato del producto y no una regla de la compra: al proveedor nuevo, o al que
   * todavía no se le cargó el catálogo, se le compra igual.
   *
   * Se repone sola al cambiar de proveedor: la decisión de haberlo apagado era sobre el anterior.
   */
  protected readonly supplierFilterEnabled = linkedSignal({
    source: () => this.supplier()?.uuid ?? null,
    computation: () => true,
  });

  /** El proveedor por el que se está filtrando ahora mismo, o `null` si no se filtra. */
  protected readonly activeSupplier = computed(() =>
    this.supplierFilterEnabled() ? this.supplier() : null,
  );

  /** Lo escrito en el campo: alimenta el autocompletado y abre la búsqueda avanzada donde quedó. */
  protected readonly term = signal('');

  /** Lecturas pendientes de respuesta. Pueden ser varias: el lector no espera a la anterior. */
  private readonly pending = signal(0);
  private readonly suggesting = signal(false);
  protected readonly searching = computed(() => this.pending() > 0 || this.suggesting());

  /** Opciones del modo búsqueda. Vacío en modo lector: ahí no hay lista de la que elegir. */
  protected readonly suggestions = signal<readonly PurchaseProductDto[]>([]);

  /**
   * Lo que el panel dibuja: las variantes de un modelo colapsadas en una fila (§5.6). El modelo
   * aparece una vez, donde apareció su primera variante, y elegirlo abre el selector de variante.
   */
  protected readonly suggestionRows = computed(() => collapseByModel(this.suggestions()));

  protected readonly suggestionKey = suggestionKey;

  /** Término de la última búsqueda ya resuelta: sin esto no se distingue «vacío» de «todavía no». */
  private readonly resolvedTerm = signal<string | null>(null);

  /** Por qué falló la última lectura. Queda a la vista hasta que se escanee de nuevo. */
  protected readonly lastError = signal<string | null>(null);

  /**
   * El desarme de la última etiqueta de balanza leída. En una compra es menos frecuente que en el
   * mostrador —la mercadería pesable se compra por bulto—, pero cuando pasa es el mismo dato el que
   * hace diagnosticable un formato mal cargado.
   */
  protected readonly lastScale = signal<ScaleReading | null>(null);

  /**
   * Que la búsqueda haya terminado sin nada. Se mira el término resuelto y no el que se está
   * tipeando: si no, la lista diría «sin resultados» en el medio de cada palabra.
   */
  protected readonly noResults = computed(
    () =>
      this.mode() === 'search' &&
      !this.suggesting() &&
      this.suggestions().length === 0 &&
      this.resolvedTerm() !== null &&
      this.resolvedTerm() === this.term().trim(),
  );

  protected readonly scanning = computed(() => this.mode() === 'scan');

  /** Tachado cuando no filtra: el ícono dice qué hay puesto, no qué pasaría al apretarlo. */
  protected readonly supplierFilterIcon = computed(() =>
    this.supplierFilterEnabled() ? 'filter_alt' : 'filter_alt_off',
  );

  /** El botón se nombra por lo que hace al apretarlo, que es lo contrario de lo que muestra. */
  protected readonly supplierFilterKey = computed(() =>
    this.supplierFilterEnabled()
      ? 'purchases.search.supplierFilter.disable'
      : 'purchases.search.supplierFilter.enable',
  );

  /**
   * Qué decir cuando la búsqueda no encontró nada. Con el filtro puesto la explicación es otra —el
   * producto puede existir y no estar vinculado— y con ella la salida: apagar el filtro.
   */
  protected readonly noResultsKey = computed(() =>
    this.activeSupplier()
      ? 'purchases.search.noResultsForSupplier'
      : 'purchases.search.noResults',
  );

  /**
   * `qr_code_scanner` y no `barcode_scanner`: la app carga la tipografía **Material Icons** clásica
   * (`index.html`), donde esa ligadura no existe y el ícono sale como el texto crudo del nombre.
   */
  protected readonly modeIcon = computed(() => (this.scanning() ? 'qr_code_scanner' : 'search'));
  protected readonly placeholderKey = computed(() => `${this.modeKey()}.placeholder`);
  protected readonly inputAriaKey = computed(() => `${this.modeKey()}.aria`);
  protected readonly hintKey = computed(() => `${this.modeKey()}.hint`);
  protected readonly toggleKey = computed(() => `${this.modeKey()}.toggle`);

  /**
   * El error se anuncia antes que el modo: cuando los dos están a la vista, lo que hay que resolver
   * es el error.
   */
  protected readonly describedBy = computed(() =>
    this.lastError() ? 'purchase-search-error purchase-search-mode' : 'purchase-search-mode',
  );

  protected readonly shortcut = MODE_SHORTCUT;

  private readonly scans = new Subject<string>();

  /**
   * Que la próxima tanda de opciones tenga que abrir el panel sola. Sólo pasa al cambiar de modo con
   * algo ya escrito: el resto de las veces la abre el propio Material al tipear.
   */
  private openOnNextSuggestions = false;

  constructor() {
    this.scans
      .pipe(
        // `concatMap` y no `switchMap`: dos lecturas seguidas son dos productos distintos, no una
        // corrección de la anterior, y se agregan en el orden en que se pasaron por el lector.
        concatMap((code) => this.lookup(code)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((lookup) => {
        this.pending.update((count) => count - 1);
        this.resolve(lookup);
      });

    // El modo y el proveedor entran en la consulta y no sólo el texto: al pasar a búsqueda con
    // algo ya escrito —o al sacar el filtro— eso que se escribió es la búsqueda que hay que
    // rehacer, y el texto por sí solo no cambió.
    toObservable(
      computed(() => ({
        mode: this.mode(),
        term: this.term().trim(),
        supplierUuid: this.activeSupplier()?.uuid ?? null,
      })),
    )
      .pipe(
        skip(1),
        debounceTime(SUGGESTIONS_DEBOUNCE_MS),
        distinctUntilChanged(
          (before, after) =>
            before.mode === after.mode &&
            before.term === after.term &&
            before.supplierUuid === after.supplierUuid,
        ),
        switchMap(({ mode, term, supplierUuid }) => this.suggest(mode, term, supplierUuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((lookup) => this.applySuggestions(lookup));
  }

  focus(): void {
    this.searchInput().nativeElement.focus();
  }

  protected onTermChange(value: string): void {
    this.term.set(value);
  }

  /**
   * Alterna entre cargar con el lector y buscar escribiendo.
   *
   * Lo escrito se conserva: quien tipeó medio nombre en el modo equivocado quiere buscar eso, no
   * volver a escribirlo. Lo que se descarta es lo que pertenecía al modo que se deja —el error de la
   * última lectura, las opciones de la última búsqueda—.
   */
  protected onToggleMode(event?: Event): void {
    event?.preventDefault();

    const next: PurchaseSearchMode = this.mode() === 'scan' ? 'search' : 'scan';

    this.autocomplete()?.closePanel();
    this.mode.set(next);
    this.modeStore.write(next);

    this.lastError.set(null);
    this.suggestions.set([]);
    this.resolvedTerm.set(null);
    this.openOnNextSuggestions =
      next === 'search' && this.term().trim().length >= PRODUCT_SUGGESTION_MIN_LENGTH;

    this.focus();
  }

  /**
   * Pone y saca el filtro por proveedor. Lo escrito se conserva: es la misma búsqueda, sobre un
   * catálogo más ancho o más angosto, y el pipeline la rehace sola con el proveedor nuevo.
   */
  protected onToggleSupplierFilter(): void {
    this.supplierFilterEnabled.update((enabled) => !enabled);
    this.focus();
  }

  /**
   * Enter del lector (o de quien tipeó el código). El campo se vacía en el acto: la lectura
   * siguiente puede llegar antes que la respuesta de ésta, y con el código anterior todavía puesto
   * los dos quedarían concatenados en un código que no existe.
   */
  protected onEnter(event: Event): void {
    // En modo búsqueda el Enter es del autocompletado: confirma la opción marcada, y si no hay
    // ninguna no hace nada. Lo que no puede hacer es agregar un producto que nadie eligió.
    if (this.mode() === 'search') {
      return;
    }

    event.preventDefault();

    const code = this.searchInput().nativeElement.value.trim();
    this.clearInput();

    if (!code) {
      return;
    }

    this.lastError.set(null);
    this.lastScale.set(null);
    this.pending.update((count) => count + 1);
    this.scans.next(code);
  }

  /**
   * La fila elegida de la lista. Un producto suelto se agrega directo —ya se eligió mirándolo—; un
   * modelo abre el selector de variante, porque el modelo no se compra (RN-12). Para reponer el
   * modelo entero está la carga por modelo, al lado de este campo.
   */
  protected onSuggestionSelected(row: SuggestionRow<PurchaseProductDto>): void {
    if (row.kind === 'product') {
      this.emit(row.product, 1, null);
      return;
    }

    this.variantPicker
      .pickFromModel(row.modelUuid, row.modelName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((variant) => {
        if (variant) {
          this.emit(variant, 1, null);
          return;
        }

        // Se cerró sin elegir: el foco vuelve al campo para poder seguir cargando.
        this.focus();
      });
  }

  /**
   * Material escribe en el campo lo que devuelva esto al elegir una opción. Devuelve vacío porque el
   * campo no muestra el producto elegido: ya está en el carrito, y lo que sigue es cargar el
   * próximo.
   */
  protected readonly displayEmpty = (): string => '';

  /**
   * Buscar por marca o categoría: lo que ni el código ni el autocompletado por texto dan.
   *
   * Sin listas de precios: en una compra el importe unitario es el costo que declara el operador, y
   * las columnas de precio del selector no dirían nada sobre lo que se está por pagar.
   */
  protected onAdvancedSearch(): void {
    const supplier = this.activeSupplier();

    this.productPicker
      .pick({
        availability: 'purchase',
        initialSearch: this.term().trim(),
        // Se abre con el mismo alcance que tiene el campo: filtrado si acá lo está. Adentro se
        // puede sacar, y esa decisión queda en el diálogo — el campo no la hereda de vuelta.
        supplier: supplier ? { uuid: supplier.uuid, name: supplier.name } : undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((product) => {
        if (product) {
          this.emit(product, 1, null);
          return;
        }

        // Se cerró sin elegir: el foco vuelve al campo para poder seguir cargando.
        this.focus();
      });
  }

  private modeKey(): string {
    return `purchases.search.modes.${this.mode()}`;
  }

  /** Una tanda de opciones, o ninguna cuando no hay búsqueda que hacer. */
  private suggest(mode: PurchaseSearchMode, term: string, supplierUuid: string | null) {
    if (mode !== 'search' || term.length < PRODUCT_SUGGESTION_MIN_LENGTH) {
      this.suggesting.set(false);
      return of<SuggestionLookup>({ term: null, products: [] });
    }

    this.suggesting.set(true);

    return this.catalogApi.searchPurchasableProducts(term, supplierUuid).pipe(
      map((products): SuggestionLookup => ({ term, products })),
      catchError(() => {
        this.toast.error(this.translate.instant('purchases.toasts.productSearchError'));
        // Sin término resuelto la lista no dice «sin resultados»: no es que no haya, es que falló.
        return of<SuggestionLookup>({ term: null, products: [] });
      }),
    );
  }

  private applySuggestions({ term, products }: SuggestionLookup): void {
    this.suggestions.set(products);
    this.resolvedTerm.set(term);
    this.suggesting.set(false);

    // El panel lo abre Material cuando se tipea; al cambiar de modo no se tipeó nada, así que las
    // opciones llegarían a un panel cerrado y sin nada que las muestre.
    if (this.openOnNextSuggestions) {
      this.openOnNextSuggestions = false;

      if (products.length > 0) {
        this.autocomplete()?.openPanel();
      }
    }
  }

  /**
   * Qué hacer con lo que devolvió la lectura. Un código identifica un producto sin ambigüedad, así
   * que la primera fila comprable es *el* producto; lo demás son errores que hay que nombrar, porque
   * «no existe» y «existe pero no se compra» se resuelven de maneras distintas.
   */
  private resolve({ code, products, quantity, packaging, scale, fromCode, failed }: CodeLookup): void {
    if (failed) {
      this.reject(this.translate.instant('purchases.toasts.productSearchError'));
      return;
    }

    // Dos motivos distintos para no poder cargarlo, y se dicen distinto porque se resuelven
    // distinto: `isForPurchase: false` es una marca del catálogo (un producto que la empresa
    // fabrica, por ejemplo), y el kit no se compra nunca — lo que se compra son sus componentes.
    const purchasable = products.find(
      (product) => product.isForPurchase !== false && !isKitProduct(product),
    );
    if (purchasable) {
      this.lastScale.set(scale);
      this.emit(purchasable, quantity, packaging, fromCode);
      return;
    }

    const kit = products.find(isKitProduct);
    if (kit) {
      this.reject(this.translate.instant('purchases.search.kitNotPurchasable', { name: kit.name }));
      return;
    }

    if (products.length > 0) {
      this.reject(
        this.translate.instant('purchases.search.notForPurchase', { name: products[0].name }),
      );
      return;
    }

    this.reject(this.translate.instant('purchases.search.notFound', { code }));
  }

  private emit(
    product: PurchaseProductDto,
    quantity: number,
    packaging: PackagingRef | null,
    quantityFromCode = false,
  ): void {
    this.lastError.set(null);
    this.productSelected.emit({ product, quantity, packaging, quantityFromCode });
    this.clearInput();
    this.focus();
  }

  /**
   * Qué carga una lectura, en dos intentos y en este orden:
   *
   * 1. `GET /product/by-barcode` — el código del producto, el del bulto (con el factor puesto) y la
   *    etiqueta de balanza. Es el único que puede: el formato de la balanza lo conoce el backend.
   * 2. El paginado por código exacto — sólo para el **SKU**, que el anterior no resuelve. Un `404`
   *    del primero no es un error todavía: puede ser un SKU tipeado a mano.
   *
   * Cualquier otra falla del primer intento corta acá: reintentar contra el paginado convertiría un
   * 500 o un 403 en un «no existe», que se arregla de otra manera.
   */
  private lookup(code: string) {
    return this.catalogApi.resolveCode(code).pipe(
      map(
        (found): CodeLookup => ({
          code,
          products: [found.product],
          quantity: scannedQuantityOf(found),
          fromCode: readCarriesQuantity(found),
          packaging: found.packaging ?? null,
          scale: found.scale ?? null,
          failed: false,
        }),
      ),
      catchError((error: unknown) =>
        hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_NOT_FOUND)
          ? this.lookupBySku(code)
          : of<CodeLookup>({
              code,
              products: [],
              quantity: 1,
              packaging: null,
              scale: null,
              fromCode: false,
              failed: true,
            }),
      ),
    );
  }

  /** El respaldo por SKU: el paginado por código exacto, que sí lo mira. */
  private lookupBySku(code: string) {
    return this.catalogApi.findProductsByCode(code).pipe(
      map(
        (products): CodeLookup => ({
          code,
          products,
          quantity: 1,
          packaging: null,
          scale: null,
          fromCode: false,
          failed: false,
        }),
      ),
      catchError(() =>
        of<CodeLookup>({
          code,
          products: [],
          quantity: 1,
          packaging: null,
          scale: null,
          fromCode: false,
          failed: true,
        }),
      ),
    );
  }

  /**
   * El error se dice dos veces a propósito: el toast interrumpe al lector de pantalla y se va, y el
   * texto bajo el campo queda para quien estaba mirando el comprobante y no la pantalla.
   */
  private reject(message: string): void {
    this.lastError.set(message);
    this.toast.error(message);
    this.focus();
  }

  private clearInput(): void {
    this.searchInput().nativeElement.value = '';
    this.term.set('');
    this.suggestions.set([]);
    this.resolvedTerm.set(null);
  }
}
