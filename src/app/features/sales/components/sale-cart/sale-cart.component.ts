import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  minQuantity,
  quantityDecimalsOf,
  quantityStep,
} from '../../../../core/product/quantity-precision';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { ExpirationChipComponent } from '../../../../shared/components/expiration-chip/expiration-chip.component';
import { StockValidationPolicy } from '../../../../core/orders/order-commit.model';
import {
  PackagingRef,
  SaleCartLineView,
  SalePackagingOption,
  SalePriceListDto,
  isVirtualKitProduct,
} from '../../data-access/sale.model';
import { SalePromotionDetailComponent } from '../sale-promotion-detail/sale-promotion-detail.component';

const COLUMNS = [
  'index',
  'select',
  'product',
  'quantity',
  'priceList',
  'unitPrice',
  'taxRate',
  'subtotal',
  'actions',
] as const;

type CartColumn = (typeof COLUMNS)[number];

/**
 * Las dos columnas que existen sólo para elegir lista. Sin listas que ofrecer —un cajero sin
 * `price_list.view` las recibe vacías— no hay nada que elegir ni para qué marcar líneas.
 */
const PRICE_LIST_COLUMNS: readonly CartColumn[] = ['select', 'priceList'];

/**
 * Con qué valor el selector dice «que la resuelva el carrito». Es un centinela y no `null` porque
 * `mat-select` nunca matchea una opción de valor nulo: dejaría el campo vacío y mostrando el
 * placeholder, justo cuando lo que hay que ver es con qué lista quedó la línea.
 *
 * Lo exporta para que la pantalla lo entienda al leer lo que eligió una fila.
 */
export const AUTO_PRICE_LIST = '__auto__';

/** Lo que eligió el selector, ya en los términos del carrito. */
export function toPriceListUuid(value: string): string | null {
  return value === AUTO_PRICE_LIST ? null : value;
}

/** Cambio de cantidad de una línea, ya resuelto a la cantidad final. */
/** El empaque que el operador eligió para una línea. `null` vuelve a unidades sueltas. */
export interface CartPackagingChange {
  productUuid: string;
  packaging: PackagingRef | null;
}

export interface CartQuantityChange {
  productUuid: string;
  quantity: number;
}

/** La unidad que el operador sacó de una línea desde su chip. */
export interface CartSerialRemove {
  productUuid: string;
  serial: string;
}

/** Qué lista aplicar y a qué líneas. `null` las devuelve a la lista del carrito. */
export interface CartPriceListChange {
  productUuids: readonly string[];
  priceListUuid: string | null;
}

/**
 * Las líneas de la venta. Es sólo presentación: no toca el carrito, avisa qué pidió el operador.
 *
 * Marca las condiciones que impiden cerrar, cada una con su motivo a la vista, porque descubrirlas
 * recién al apretar «Confirmar» obligaría a adivinar cuál de las líneas es la que traba: la que
 * pide más de lo que hay en la sucursal, y la que no tiene con qué cobrarse —sin precio en la lista
 * aplicada, o con precio cero—. Esta última se resalta entera, porque tiene arreglo ahí mismo:
 * elegirle otra lista.
 *
 * La lista se cambia en tres alcances, del más grueso al más fino, y el más fino gana: la de todo
 * el carrito —desde el encabezado de la columna «Lista»—, la de las líneas marcadas y la de una
 * línea sola. Los tres se piden acá, cada uno desde donde alcanza: el encabezado manda sobre la
 * columna entera, la barra de marcadas sobre lo que esté marcado y el selector de la fila sobre su
 * línea. La marca es de la grilla y no del carrito —es a qué le estoy por hacer algo, no qué se
 * vende—, así que vive acá también, y lo marcado se puede además sacar del carrito de una vez.
 */
@Component({
  selector: 'app-sale-cart',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    SalePromotionDetailComponent,
    CurrencyDisplayComponent,
    ExpirationChipComponent,
  ],
  templateUrl: './sale-cart.component.html',
  styleUrl: './sale-cart.component.css',
})
export class SaleCartComponent {
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly lines = input.required<readonly SaleCartLineView[]>();

  /** Política de la sucursal: decide si un faltante bloquea o solo advierte. */
  /**
   * La política de faltantes de la sucursal, o `null` cuando no se pudo leer. Sin ella el carrito
   * **muestra** los faltantes pero no bloquea: avisar de más es barato, frenar una venta que la
   * sucursal permite no lo es.
   */
  readonly stockPolicy = input.required<StockValidationPolicy | null>();

  /** Listas entre las que se puede elegir. Vacío esconde toda la elección de lista. */
  readonly priceLists = input<readonly SalePriceListDto[]>([]);

  /**
   * La lista fijada para todo el carrito, o `null` —lo normal— cuando la resuelve el cliente. La
   * decide el encabezado de la columna, pero el dato es del carrito: lo sostiene la pantalla.
   */
  readonly cartPriceListUuid = input<string | null>(null);

  /**
   * Si el operador puede elegir a mano de qué lote sale una línea (`stock.batch_select`). Sin él
   * el lote asignado se ve pero no se cambia: la política de la sucursal no es una jaula, pero
   * salirse de ella es un permiso propio (§7.3).
   */
  readonly canSelectBatch = input(false);

  /**
   * La línea sobre la que actúan las teclas, marcada por la pantalla. `null` con el carrito vacío.
   *
   * Es una sola y es distinta de las marcas de los checkboxes: aquélla es «a qué le voy a aplicar
   * una lista», ésta es «dónde estoy parado». Vive afuera porque quien la mueve es el teclado de la
   * pantalla, no la tabla.
   */
  readonly activeUuid = input<string | null>(null);

  /** El operador se paró en otra fila con el mouse. */
  readonly activeChange = output<string>();

  readonly quantityChange = output<CartQuantityChange>();
  /** La línea cuyo lote hay que elegir: la pantalla abre el selector y vuelve por el carrito. */
  readonly batchPick = output<SaleCartLineView>();
  /** Vuelve la línea al lote que decida la política de la sucursal. */
  readonly batchReset = output<string>();
  /** Abrir el selector de unidades de una línea serializada. */
  readonly serialPick = output<SaleCartLineView>();
  /** Sacar una unidad de la línea desde su chip, sin abrir el selector. */
  readonly serialRemove = output<CartSerialRemove>();
  /** El empaque con el que se carga una línea: `null` vuelve a unidades sueltas. */
  readonly packagingChange = output<CartPackagingChange>();
  readonly cartPriceListChange = output<string | null>();
  readonly priceListChange = output<CartPriceListChange>();
  readonly lineRemove = output<string>();
  readonly selectionRemove = output<readonly string[]>();
  readonly clear = output<void>();

  /**
   * Las líneas marcadas para la acción en lote. Se queda con lo que siga en el carrito: una línea
   * que se quitó no puede seguir marcada, pero cambiarle la cantidad a otra no tiene por qué soltar
   * la marca —el carrito se reemplaza entero en cada edición—.
   */
  private readonly selection = linkedSignal<readonly SaleCartLineView[], ReadonlySet<string>>({
    source: this.lines,
    computation: (lines, previous) => {
      if (!previous) {
        return new Set<string>();
      }

      const alive = new Set(lines.map((line) => line.product.uuid));
      const kept = [...previous.value].filter((uuid) => alive.has(uuid));

      return kept.length === previous.value.size ? previous.value : new Set(kept);
    },
  });

  protected readonly selectedCount = computed(() => this.selection().size);

  protected readonly allSelected = computed(
    () => this.lines().length > 0 && this.selection().size === this.lines().length,
  );

  protected readonly someSelected = computed(
    () => this.selection().size > 0 && !this.allSelected(),
  );

  protected readonly canChoosePriceList = computed(() => this.priceLists().length > 0);

  protected readonly displayedColumns = computed<readonly CartColumn[]>(() =>
    this.canChoosePriceList()
      ? COLUMNS
      : COLUMNS.filter((column) => !PRICE_LIST_COLUMNS.includes(column)),
  );

  private readonly priceListNames = computed(
    () => new Map(this.priceLists().map((list) => [list.uuid, list.name])),
  );

  /** Con qué lista quedó el carrito, para nombrarla en el encabezado. `null` es «la del cliente». */
  protected readonly cartPriceListName = computed(() =>
    this.priceListName(this.cartPriceListUuid()),
  );

  /** `FORCE_SALE` vende en negativo a propósito: ahí el faltante no es algo que reportar. */
  protected readonly showsShortages = computed(() => this.stockPolicy() !== 'FORCE_SALE');

  protected readonly blocksOnShortage = computed(() => this.stockPolicy() === 'STRICT_BLOCK');

  protected readonly AUTO_PRICE_LIST = AUTO_PRICE_LIST;

  constructor() {
    // Con veinte líneas cargadas, mover la marca con las flechas la saca de la parte visible del
    // scroll y el carrito parece no responder. `nearest` la trae de vuelta con el mínimo movimiento:
    // avanzar de a una fila no debería reacomodar toda la tabla.
    effect(() => {
      const uuid = this.activeUuid();
      if (!uuid) {
        return;
      }

      this.host.nativeElement
        .querySelector(`[data-line="${uuid}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  /**
   * Kits desplegados. Arranca vacío —el carrito se lee de un vistazo, y el detalle del combo es
   * información de segundo orden— y es por producto, que es como se identifica la línea.
   */
  private readonly expandedKits = signal<ReadonlySet<string>>(new Set());

  /**
   * Si la fila se dibuja **como combo**: despliega qué trae, su importe queda entero en la padre
   * (RN-08), el disponible sale de los componentes y la alícuota se prorratea.
   *
   * Es el kit virtual y sólo él: un armado es una mercadería más en el carrito, y dibujarlo así le
   * contaría al mostrador un faltante que no tiene (RN-22).
   */
  protected isKit(line: SaleCartLineView): boolean {
    return isVirtualKitProduct(line.product);
  }

  protected isKitExpanded(line: SaleCartLineView): boolean {
    return this.expandedKits().has(line.product.uuid);
  }

  protected onToggleKit(line: SaleCartLineView): void {
    this.expandedKits.update((current) => {
      const next = new Set(current);
      if (!next.delete(line.product.uuid)) {
        next.add(line.product.uuid);
      }
      return next;
    });
  }

  /**
   * Los componentes que no alcanzan, nombrados. Es lo que se dice en vez de «faltan 3 combos»: un
   * kit no tiene saldo propio, así que lo que hay que reponer es la parte que se quedó corta.
   */
  protected shortComponents(line: SaleCartLineView): string {
    return line.kitComponents
      .filter((component) => component.shortage > 0)
      .map((component) => component.name)
      .join(', ');
  }

  /**
   * Con qué salto se mueve la cantidad de la línea: de a uno en un producto que se vende por unidad,
   * de a un gramo en uno que se vende por kilo. Lo declara la unidad del producto, y `'any'` es el
   * producto que no declara ninguna —ahí el navegador acepta cualquier decimal—.
   */
  protected step(line: SaleCartLineView): number | 'any' {
    // Con empaque el input cuenta cajas: la precisión de la unidad se aplica sobre la cantidad en
    // unidad base que resulta de multiplicar, y eso lo hace el carrito. Acotarla acá inventaría una
    // restricción sobre las cajas que del otro lado no existe.
    return line.packaging ? 'any' : quantityStep(quantityDecimalsOf(line.product));
  }

  /** La cantidad más chica que se puede pedir, la del salto de la unidad. */
  protected min(line: SaleCartLineView): number | null {
    return line.packaging ? null : minQuantity(quantityDecimalsOf(line.product));
  }

  /**
   * Lo que muestra el input: cajas con empaque elegido, unidades base sin él. La cantidad que el
   * carrito guarda es **siempre** la de unidad base (RN-16); esto es sólo en qué unidad se escribe.
   */
  protected displayedQuantity(line: SaleCartLineView): number {
    return line.packageQuantity ?? line.quantity;
  }

  /** Los empaques que el producto declara. Vacío esconde el selector. */
  protected packagingOptions(line: SaleCartLineView): readonly SalePackagingOption[] {
    return line.product.packagings ?? [];
  }

  /**
   * La equivalencia de la línea, al lado del input: «= 24 un». Es lo que evita que el número de la
   * fila se lea como unidades cuando en realidad son cajas. `null` sin empaque, donde el número ya
   * está en unidad base y no hay nada que aclarar.
   */
  protected equivalence(line: SaleCartLineView): string | null {
    if (!line.packaging) {
      return null;
    }

    return this.translate.instant('sales.cart.packaging.equivalence', {
      quantity: line.quantity,
      unit: this.unitLabel(line),
    });
  }

  /** El empaque de la línea que tiene ese uuid; `null` es la opción «sueltas». */
  protected packagingByUuid(
    line: SaleCartLineView,
    uuid: string | null,
  ): SalePackagingOption | null {
    return uuid ? (this.packagingOptions(line).find((row) => row.uuid === uuid) ?? null) : null;
  }

  /** El nombre de la unidad base, traducido: es cómo se llama la opción «sueltas». */
  protected unitName(line: SaleCartLineView): string {
    return this.unitLabel(line);
  }

  protected onPackagingChange(line: SaleCartLineView, option: SalePackagingOption | null): void {
    this.packagingChange.emit({
      productUuid: line.product.uuid,
      packaging: option ? { uuid: option.uuid, name: option.name, factor: option.factor } : null,
    });
  }

  /** El nombre de la unidad base, traducido, para la equivalencia. */
  private unitLabel(line: SaleCartLineView): string {
    const unit = line.product.unitMeasure;
    return unit ? this.translate.instant(`products.unitMeasures.${unit}`) : '';
  }

  /** Cuánto sube o baja un paso de los botones: una caja con empaque, una unidad sin él. */
  private lineStep(line: SaleCartLineView): number {
    return line.packaging && line.packaging.factor > 0 ? line.packaging.factor : 1;
  }

  /**
   * El `−` hace **una unidad entera o nada**: se apaga cuando bajar una unidad dejaría la línea por
   * debajo del mínimo. En un producto por peso eso significa que a 1,75 kg se puede bajar a 0,75, pero
   * a 0,75 el botón queda apagado en vez de colapsar la línea al gramo mínimo —para menos de un kilo
   * el número se escribe, que es como se pesa en el mostrador—.
   */
  protected canDecrease(line: SaleCartLineView): boolean {
    const next = line.quantity - this.lineStep(line);
    const floor = line.packaging ? null : this.min(line);

    return floor === null ? next > 0 : next >= floor;
  }

  /**
   * Los botones mueven de a una unidad y no de a un salto de la precisión: en un producto por kilo,
   * `+` sube de a 1 kg y no de a un gramo. El redondeo final lo hace el carrito, que es el único que
   * sabe a qué precisión ajustar.
   */
  protected onDecrease(line: SaleCartLineView): void {
    this.quantityChange.emit({
      productUuid: line.product.uuid,
      quantity: line.quantity - this.lineStep(line),
    });
  }

  protected onIncrease(line: SaleCartLineView): void {
    this.quantityChange.emit({
      productUuid: line.product.uuid,
      quantity: line.quantity + this.lineStep(line),
    });
  }

  /**
   * `parseFloat` y no `parseInt`: truncar acá es lo que hacía que un `0,75` tipeado en un producto que
   * se vende por kilo llegara al carrito como `0`. Quien decide la precisión final es el carrito.
   */
  protected onQuantityInput(line: SaleCartLineView, value: string): void {
    const typed = Number.parseFloat(value);
    if (Number.isNaN(typed)) {
      return;
    }

    // Lo tipeado son cajas cuando la línea tiene empaque: se convierte acá y lo que sale del
    // componente es siempre la cantidad en unidad base, que es la única que el carrito guarda.
    this.quantityChange.emit({
      productUuid: line.product.uuid,
      quantity: typed * this.lineStep(line),
    });
  }

  protected isSelected(line: SaleCartLineView): boolean {
    return this.selection().has(line.product.uuid);
  }

  protected onToggleLine(line: SaleCartLineView): void {
    this.selection.update((selected) => {
      const next = new Set(selected);

      if (!next.delete(line.product.uuid)) {
        next.add(line.product.uuid);
      }

      return next;
    });
  }

  /** Todo o nada: con algo marcado, el encabezado suelta la marca en vez de completarla. */
  protected onToggleAll(): void {
    this.selection.set(
      this.selection().size > 0
        ? new Set()
        : new Set(this.lines().map((line) => line.product.uuid)),
    );
  }

  protected onClearSelection(): void {
    this.selection.set(new Set());
  }

  protected isCartPriceList(uuid: string | null): boolean {
    return this.cartPriceListUuid() === uuid;
  }

  /**
   * El alcance más grueso: la lista de todo el carrito. No pasa por el centinela porque acá cada
   * opción es un botón del menú y puede mandar el `null` tal cual.
   */
  protected onCartPriceList(priceListUuid: string | null): void {
    this.cartPriceListChange.emit(priceListUuid);
  }

  protected onLinePriceList(line: SaleCartLineView, value: string): void {
    this.priceListChange.emit({
      productUuids: [line.product.uuid],
      priceListUuid: toPriceListUuid(value),
    });
  }

  /** La acción en lote: la misma lista para todo lo marcado, de una. */
  protected onSelectionPriceList(value: string): void {
    this.priceListChange.emit({
      productUuids: [...this.selection()],
      priceListUuid: toPriceListUuid(value),
    });
  }

  /**
   * Saca del carrito todo lo marcado. Sin confirmación, igual que el tacho de cada fila: marcar y
   * apretar ya son dos gestos, y lo que se saca se vuelve a escanear.
   */
  protected onSelectionRemove(): void {
    this.selectionRemove.emit([...this.selection()]);
  }

  /** El nombre con el que se conoce a una lista, o `null` si no está en el catálogo recibido. */
  protected priceListName(uuid: string | null): string | null {
    return uuid === null ? null : (this.priceListNames().get(uuid) ?? null);
  }
}
