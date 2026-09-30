import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
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
  Observable,
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
import { PickerPriceList } from '../../../../core/product-picker/product-picker.model';
import { ProductPickerService } from '../../../../core/product-picker/product-picker.service';
import { VariantPickerService } from '../../../../core/product-picker/variant-picker.service';
import {
  SuggestionRow,
  collapseByModel,
  suggestionKey,
} from '../../../../core/product-picker/suggestion-grouping';
import { API_ERROR_CODES, hasApiErrorCode } from '../../../../core/http/api-error.model';
import {
  PackagingRef,
  ScaleReading,
  readCarriesQuantity,
  scannedQuantityOf,
} from '../../../../core/product/product-lookup.model';
import { SerialState } from '../../../../core/stock/stock-serial.model';
import { StockSerialsApiService } from '../../../../core/stock/stock-serials-api.service';
import { SaleProductDto } from '../../data-access/sale.model';
import {
  PRODUCT_SUGGESTION_MIN_LENGTH,
  SalesCatalogApiService,
} from '../../data-access/sales-catalog-api.service';

/**
 * Qué pasó con una lectura. Los cuatro se dicen distinto porque se arreglan distinto: volver a
 * pasar el producto, elegirlo de la lista, buscar otra unidad, o llamar a alguien.
 */
type CodeOutcome =
  /** Hay producto que cargar. */
  | 'resolved'
  /** Ningún código, SKU ni número de serie de la sucursal se lee así. */
  | 'notFound'
  /** La serie existe pero no está en el mostrador: vendida, en viaje, dada de baja. */
  | 'serialUnavailable'
  /** La consulta se cayó (red, 500): distinto de «no hay nada con ese código». */
  | 'failed';

/** Resultado de una lectura, con el código que la originó para poder explicar el error. */
interface CodeLookup {
  code: string;
  outcome: CodeOutcome;
  products: readonly SaleProductDto[];
  /**
   * Cuántas unidades base carga esa lectura: el peso de la etiqueta de balanza, el factor de la
   * caja, o `1`. Ya viene resuelto por el backend, que es el único que conoce el formato de la
   * balanza de la empresa.
   */
  quantity: number;
  /** El empaque que resolvió el código, si fue el de una caja. */
  packaging: PackagingRef | null;
  /** El desarme de la etiqueta, cuando lo que se leyó fue una. Se muestra en el campo. */
  scale: ScaleReading | null;
  /** Si la lectura trajo su propia cantidad. Ver {@link readCarriesQuantity}. */
  fromCode: boolean;
  /** La unidad identificada que resolvió el código, o `null` si lo leído no fue una serie. */
  serial: string | null;
  /** Dónde está la unidad que no se puede vender, para poder decirlo. */
  serialState: SerialState | null;
}

/** Una lectura que no cargó nada, con el motivo puesto. */
function emptyLookup(code: string, outcome: CodeOutcome, serialState: SerialState | null = null): CodeLookup {
  return {
    code,
    outcome,
    products: [],
    quantity: 1,
    packaging: null,
    scale: null,
    fromCode: false,
    serial: null,
    serialState,
  };
}

/** Lo que sale del campo cuando entra mercadería: el producto y cuánto carga la lectura. */
export interface ProductScanned {
  product: SaleProductDto;
  /** Cantidad en **unidad base**. `1` en una elección de la lista, el peso en una etiqueta. */
  quantity: number;
  packaging: PackagingRef | null;
  /**
   * Si la lectura determinó ella misma la cantidad (el peso de la etiqueta, el factor de la caja).
   * En `false` la cantidad es el «1 neutro» y el carrito puede arrancar la línea en un empaque.
   */
  quantityFromCode: boolean;
  /**
   * La unidad identificada que se leyó, cuando lo escaneado fue un número de serie. La línea entra
   * con esa serie ya elegida: el operador no la vuelve a buscar en un selector.
   */
  serial: string | null;
}

/** Opciones del autocompletado, con el término que las resolvió. */
interface SuggestionLookup {
  /** `null` cuando no hubo búsqueda que responder: término corto o consulta fallida. */
  term: string | null;
  products: readonly SaleProductDto[];
}

/** Cuánto se espera entre teclas antes de preguntarle al backend. */
const SUGGESTIONS_DEBOUNCE_MS = 250;

/**
 * El campo por el que entra la mercadería al carrito. **Uno solo, sin modos**: se escanea, se tipea
 * un código o se tipea un nombre en el mismo lugar, porque en un mostrador el operador no sabe cuál
 * de las tres cosas va a necesitar hasta que tiene el producto en la mano — y acordarse de apretar
 * una tecla antes de cada una es exactamente el error que después se paga cargando la venta de nuevo.
 *
 * Quién decide es el **Enter**, y decide en este orden:
 *
 * 1. Si el operador marcó una opción de la lista con las flechas, entra esa. Es una elección
 *    explícita y le gana a cualquier interpretación del texto.
 * 2. Si no, lo escrito se resuelve como lectura: código de barras del producto o de una de sus cajas
 *    y etiqueta de balanza (`GET /product/by-barcode`), después SKU exacto, y por último número de
 *    serie. La primera que resuelve gana y el producto entra solo.
 * 3. Si nada de eso resolvió, es un error con nombre —«ningún producto tiene ese código»— y **no**
 *    se adivina eligiendo de la lista: en el mostrador, cargar el producto equivocado sale más caro
 *    que volver a pasarlo por el lector.
 *
 * Mientras se tipea, y en paralelo, el campo va ofreciendo coincidencias por nombre, SKU o código.
 * Son para elegir con el mouse o con las flechas, nunca automáticamente: por eso el panel no
 * preselecciona ninguna (`autoActiveFirstOption` está deliberadamente afuera). Un lector láser tipea
 * el código y manda el Enter en menos de lo que tarda el debounce, así que cuando escanea no hay
 * lista abierta que pueda entrometerse.
 *
 * Buscar por marca o categoría es otra cosa y sigue teniendo su propio lugar: el botón de búsqueda
 * avanzada, que abre el selector de productos completo.
 *
 * Se queda con el foco: la lectura siguiente llega enseguida y no hay tiempo de volver a hacer clic.
 */
@Component({
  selector: 'app-sale-product-search',
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
  templateUrl: './sale-product-search.component.html',
  styleUrl: './sale-product-search.component.css',
})
export class SaleProductSearchComponent {
  private readonly catalogApi = inject(SalesCatalogApiService);
  private readonly serialsApi = inject(StockSerialsApiService);
  private readonly productPicker = inject(ProductPickerService);
  private readonly variantPicker = inject(VariantPickerService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  /** Listas activas: el selector muestra una columna de precio por cada una. */
  readonly priceLists = input<readonly PickerPriceList[]>([]);

  readonly productSelected = output<ProductScanned>();

  private readonly searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly autocomplete = viewChild(MatAutocompleteTrigger);

  /** Lo escrito en el campo: alimenta el autocompletado y abre la búsqueda avanzada donde quedó. */
  protected readonly term = signal('');

  /** Lecturas pendientes de respuesta. Pueden ser varias: el lector no espera a la anterior. */
  private readonly pending = signal(0);
  private readonly suggesting = signal(false);
  protected readonly searching = computed(() => this.pending() > 0 || this.suggesting());

  /** Coincidencias por nombre, SKU o código de lo que se está tipeando. */
  protected readonly suggestions = signal<readonly SaleProductDto[]>([]);

  /**
   * Lo que el panel dibuja: las variantes de un modelo colapsadas en una fila (§5.6). Doce
   * variantes que inundan la lista son doce filas que el operador tiene que leer con el cliente
   * esperando; el modelo aparece una vez y elegirlo abre el selector.
   */
  protected readonly suggestionRows = computed(() => collapseByModel(this.suggestions()));

  protected readonly suggestionKey = suggestionKey;

  /** Término de la última búsqueda ya resuelta: sin esto no se distingue «vacío» de «todavía no». */
  private readonly resolvedTerm = signal<string | null>(null);

  /** Por qué falló la última lectura. Queda a la vista hasta que se escanee de nuevo. */
  protected readonly lastError = signal<string | null>(null);

  /**
   * El desarme de la última etiqueta de balanza leída, o `null` si la última lectura no fue una.
   *
   * Se muestra debajo del campo porque es **lo único que hay que entender para configurar bien el
   * formato**, y es lo que hace diagnosticable uno mal cargado: si el prefijo o los largos no eran
   * los de esa balanza, se ve en el desarme antes de que nadie revise la configuración.
   */
  protected readonly lastScale = signal<ScaleReading | null>(null);

  /**
   * Que la búsqueda haya terminado sin nada. Se mira el término resuelto y no el que se está
   * tipeando: si no, la lista diría «sin resultados» en el medio de cada palabra.
   */
  protected readonly noResults = computed(
    () =>
      !this.suggesting() &&
      this.suggestions().length === 0 &&
      this.resolvedTerm() !== null &&
      this.resolvedTerm() === this.term().trim(),
  );

  /**
   * El error se anuncia antes que la ayuda: cuando los dos están a la vista, lo que hay que resolver
   * es el error.
   */
  protected readonly describedBy = computed(() =>
    this.lastError() ? 'sale-search-error sale-search-hint' : 'sale-search-hint',
  );

  private readonly scans = new Subject<string>();

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

    toObservable(computed(() => this.term().trim()))
      .pipe(
        skip(1),
        debounceTime(SUGGESTIONS_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((term) => this.suggest(term)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((lookup) => this.applySuggestions(lookup));
  }

  focus(): void {
    this.searchInput().nativeElement.focus();
  }

  /**
   * Si el evento salió de este campo. Lo pregunta el teclado de la pantalla, que atiende las teclas
   * en `document` y necesita saber si el foco está donde se escanea: ahí las flechas son del carrito
   * y no del cursor, y `Supr` saca una línea en vez de borrar un carácter.
   */
  ownsTarget(target: EventTarget | null): boolean {
    return target === this.searchInput().nativeElement;
  }

  /** Si el panel de coincidencias está desplegado: mientras lo esté, las flechas eligen ahí adentro. */
  isSuggesting(): boolean {
    return this.autocomplete()?.panelOpen ?? false;
  }

  /**
   * Deja el campo como recién abierto y vuelve a él. Es lo que hace `Esc`: la lectura que salió mal
   * o el nombre a medio escribir se descartan de una tecla, sin buscar el campo con el mouse.
   */
  reset(): void {
    this.autocomplete()?.closePanel();
    this.clearInput();
    this.lastError.set(null);
    this.focus();
  }

  protected onTermChange(value: string): void {
    this.term.set(value);
  }

  /**
   * Enter: el lector siempre termina con uno, y quien tipea también.
   *
   * Con una opción marcada con las flechas no hace nada acá: la elige Material, que es lo que el
   * operador pidió al bajar hasta ella. Sin ninguna marcada, lo escrito es una lectura y se resuelve
   * como tal.
   *
   * El campo se vacía en el acto: la lectura siguiente puede llegar antes que la respuesta de ésta,
   * y con el código anterior todavía puesto los dos quedarían concatenados en un código que no
   * existe.
   */
  protected onEnter(event: Event): void {
    if (this.autocomplete()?.activeOption) {
      return;
    }

    event.preventDefault();

    const code = this.searchInput().nativeElement.value.trim();

    if (!code) {
      return;
    }

    this.clearInput();
    this.autocomplete()?.closePanel();

    this.lastError.set(null);
    this.lastScale.set(null);
    this.pending.update((count) => count + 1);
    this.scans.next(code);
  }

  /**
   * La fila elegida de la lista. Un producto suelto se agrega directo —ya se eligió mirándolo—; un
   * modelo abre el selector de variante, porque el modelo no se vende (RN-12).
   */
  protected onSuggestionSelected(row: SuggestionRow<SaleProductDto>): void {
    if (row.kind === 'product') {
      this.emit(row.product, 1, null);
      return;
    }

    this.variantPicker
      .pickFromModel(row.modelUuid, row.modelName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((variant) => {
        if (variant) {
          this.emit(variant as SaleProductDto, 1, null);
          return;
        }
        // Se cerró sin elegir: el foco vuelve al campo para poder seguir escaneando.
        this.focus();
      });
  }

  /**
   * Material escribe en el campo lo que devuelva esto al elegir una opción. Devuelve vacío porque el
   * campo no muestra el producto elegido: ya está en el carrito, y lo que sigue es cargar el
   * próximo.
   */
  protected readonly displayEmpty = (): string => '';

  /** Buscar por marca o categoría: lo que ni el código ni el autocompletado por texto dan. */
  protected onAdvancedSearch(): void {
    this.productPicker
      .pick({
        availability: 'sale',
        initialSearch: this.term().trim(),
        priceLists: this.priceLists(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((product) => {
        if (product) {
          this.emit(product, 1, null);
          return;
        }

        // Se cerró sin elegir: el foco vuelve al campo para poder seguir escaneando.
        this.focus();
      });
  }

  /**
   * Qué carga una lectura, en tres intentos y en este orden:
   *
   * 1. `GET /product/by-barcode` — resuelve el código del producto, el de una de sus cajas (con el
   *    factor puesto) y la etiqueta de balanza (con el peso adentro). Es el único que puede: el
   *    formato de la balanza lo conoce el backend.
   * 2. El paginado por código exacto — sólo para el **SKU**, que el endpoint anterior no resuelve.
   *    Un `404` del primero no es un error todavía: puede ser un SKU tipeado a mano.
   * 3. El número de serie. Va último a propósito: es el intento más caro —resuelve la unidad y
   *    después hay que traer el producto— y el menos frecuente, así que no se le hace pagar a las
   *    dos lecturas que cubren casi todo el mostrador.
   *
   * Cualquier otra falla del primer intento corta acá: reintentar contra el paginado convertiría un
   * 500 o un 403 en un «no existe», que se arregla de otra manera.
   */
  private lookup(code: string): Observable<CodeLookup> {
    return this.catalogApi.resolveCode(code).pipe(
      map(
        (found): CodeLookup => ({
          code,
          outcome: 'resolved',
          products: [found.product],
          quantity: scannedQuantityOf(found),
          fromCode: readCarriesQuantity(found),
          packaging: found.packaging ?? null,
          scale: found.scale ?? null,
          serial: null,
          serialState: null,
        }),
      ),
      catchError((error: unknown) =>
        hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_NOT_FOUND)
          ? this.lookupBySku(code)
          : of(emptyLookup(code, 'failed')),
      ),
    );
  }

  /** El respaldo por SKU: el paginado por código exacto, que sí lo mira. */
  private lookupBySku(code: string): Observable<CodeLookup> {
    return this.catalogApi.findProductsByCode(code).pipe(
      switchMap((products) =>
        products.length > 0
          ? of<CodeLookup>({
              code,
              outcome: 'resolved',
              products,
              quantity: 1,
              packaging: null,
              scale: null,
              fromCode: false,
              serial: null,
              serialState: null,
            })
          : this.lookupBySerial(code),
      ),
      catchError(() => of(emptyLookup(code, 'failed'))),
    );
  }

  /**
   * El último intento: que lo leído sea el número de serie de una unidad (§9).
   *
   * Resuelve la **unidad** y no el producto, así que hace falta una segunda lectura para traer con
   * qué cobrar. Sólo entra la que está en el mostrador: una vendida, una en viaje o una dada de baja
   * existen —y se dice en qué estado están, que es lo que el mostrador necesita saber—, pero no se
   * pueden volver a vender.
   *
   * Un `403` —el cajero no tiene `stock.serial_view`— se trata igual que un `404`: en esa terminal
   * los números de serie no son una forma de cargar, y decirlo como «no se encontró» es más honesto
   * que ofrecer un permiso que no se puede usar.
   */
  private lookupBySerial(code: string): Observable<CodeLookup> {
    return this.serialsApi.lookup(code).pipe(
      switchMap((unit) =>
        unit.state === 'IN_STOCK'
          ? this.catalogApi.getProductByUuid(unit.product.uuid).pipe(
              map(
                (product): CodeLookup => ({
                  code,
                  outcome: 'resolved',
                  products: [product],
                  quantity: 1,
                  packaging: null,
                  scale: null,
                  fromCode: true,
                  serial: unit.serialNumber,
                  serialState: null,
                }),
              ),
              // La unidad está en stock pero la sucursal activa no ofrece el producto: para este
              // mostrador es como si el número no existiera.
              catchError(() => of(emptyLookup(code, 'notFound'))),
            )
          : of(emptyLookup(code, 'serialUnavailable', unit.state)),
      ),
      catchError(() => of(emptyLookup(code, 'notFound'))),
    );
  }

  /** Una tanda de opciones, o ninguna cuando no hay búsqueda que hacer. */
  private suggest(term: string): Observable<SuggestionLookup> {
    if (term.length < PRODUCT_SUGGESTION_MIN_LENGTH) {
      this.suggesting.set(false);
      return of<SuggestionLookup>({ term: null, products: [] });
    }

    this.suggesting.set(true);

    return this.catalogApi.searchSellableProducts(term).pipe(
      map((products): SuggestionLookup => ({ term, products })),
      catchError(() => {
        this.toast.error(this.translate.instant('sales.toasts.productSearchError'));
        // Sin término resuelto la lista no dice «sin resultados»: no es que no haya, es que falló.
        return of<SuggestionLookup>({ term: null, products: [] });
      }),
    );
  }

  private applySuggestions({ term, products }: SuggestionLookup): void {
    this.suggestions.set(products);
    this.resolvedTerm.set(term);
    this.suggesting.set(false);
  }

  /**
   * Qué hacer con lo que devolvió la lectura. Un código identifica un producto sin ambigüedad, así
   * que la primera fila vendible es *el* producto; lo demás son errores que hay que nombrar, porque
   * «no existe», «existe pero no se vende» y «esa unidad ya se vendió» se resuelven de maneras
   * distintas.
   */
  private resolve({
    code,
    outcome,
    products,
    quantity,
    packaging,
    scale,
    fromCode,
    serial,
    serialState,
  }: CodeLookup): void {
    if (outcome === 'failed') {
      this.reject(this.translate.instant('sales.toasts.productSearchError'));
      return;
    }

    if (outcome === 'serialUnavailable') {
      this.reject(
        this.translate.instant('sales.search.serialUnavailable', {
          serial: code,
          state: this.translate.instant(`stock.serial.states.${serialState}`),
        }),
      );
      return;
    }

    // `isForSale: false` es un producto que la empresa marcó como no vendible (un insumo, un
    // envase): existe y tiene stock, pero no es una opción del punto de venta.
    const sellable = products.find((product) => product.isForSale !== false);
    if (sellable) {
      this.lastScale.set(scale);
      this.emit(sellable, quantity, packaging, fromCode, serial);
      return;
    }

    if (products.length > 0) {
      this.reject(this.translate.instant('sales.search.notForSale', { name: products[0].name }));
      return;
    }

    this.reject(this.translate.instant('sales.search.notFound', { code }));
  }

  private emit(
    product: SaleProductDto,
    quantity: number,
    packaging: PackagingRef | null,
    quantityFromCode = false,
    serial: string | null = null,
  ): void {
    this.lastError.set(null);
    this.productSelected.emit({ product, quantity, packaging, quantityFromCode, serial });
    this.clearInput();
    this.focus();
  }

  /**
   * El error se dice dos veces a propósito: el toast interrumpe al lector de pantalla y se va, y el
   * texto bajo el campo queda para quien estaba mirando el producto y no la pantalla.
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
