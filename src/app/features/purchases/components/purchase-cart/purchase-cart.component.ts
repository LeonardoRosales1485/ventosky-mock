import { Component, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
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
import { packageQuantityOf } from '../../../../core/product/product-lookup.model';
import {
  PackagingRef,
  PurchaseBatchSplit,
  PurchaseCartLineView,
  PurchasePackagingOption,
  acceptsExpiration,
  requiresExpiration,
} from '../../data-access/purchase.model';

const COLUMNS = [
  'product',
  'packaging',
  'quantity',
  'unitCost',
  'taxRate',
  'subtotal',
  'actions',
] as const;

/** La fila de reparto que cuelga de una línea con partidas: una sola celda a lo ancho. */
const BATCH_ROW_COLUMNS = ['batches'] as const;

/** La fila de carga de series, con el mismo criterio: una celda a lo ancho debajo de la línea. */
const SERIAL_ROW_COLUMNS = ['serials'] as const;

/** Cambio de cantidad de una línea, ya resuelto a la cantidad final. */
/** El empaque que el operador eligió para una línea. `null` vuelve a unidades sueltas. */
export interface PurchasePackagingChange {
  productUuid: string;
  packaging: PackagingRef | null;
}

export interface PurchaseQuantityChange {
  productUuid: string;
  quantity: number;
}

/** Costo por unidad que declaró el operador. `null` deja la línea sin cargar. */
export interface PurchaseUnitCostChange {
  productUuid: string;
  unitCost: number | null;
}

/** El reparto en partidas de una línea, completo: quien edita una fila manda la lista entera. */
export interface PurchaseBatchesChange {
  productUuid: string;
  batches: readonly PurchaseBatchSplit[];
}

/**
 * Los números de serie de una línea, completos: quien edita el pegado manda la lista entera.
 *
 * La cantidad de la línea la deriva el carrito de esta lista (RN-17), así que este evento es lo
 * único que hace falta para dejar la línea consistente.
 */
export interface PurchaseSerialsChange {
  productUuid: string;
  serials: readonly string[];
}

let batchKeySequence = 0;

/**
 * Las líneas de la compra. Es sólo presentación: no toca el carrito, avisa qué pidió el operador.
 *
 * La diferencia de fondo con la grilla de la venta es la columna de **costo**: en venta el precio
 * lo resuelve la lista y la celda sólo lo muestra, acá lo escribe una persona y es el dato central
 * de la pantalla. La línea sin costo queda marcada, porque es lo único que puede trabar el commit
 * —el backend rechaza una compra sin costo— y descubrirlo recién al confirmar obligaría a adivinar
 * cuál de las líneas es.
 *
 * Un producto con partidas (`stock_tracking = BATCH`) abre debajo de su línea el **reparto en
 * partidas** (§7.2): número de lote, vencimiento y cuántas unidades entran en cada una, como llega
 * el remito —dos lotes en un renglón—. Vive dentro de la línea y no en un diálogo, y el contador
 * «30 de 30 repartidas» es la validación, visible antes de confirmar. Con la línea en bultos, la
 * partida también se carga en bultos —«20 cajas»— y al lado se ve a cuántas unidades base equivale,
 * que es lo que tiene que cuadrar (RN-16).
 *
 * El **empaque** tiene columna propia (wireframe `1o`): la compra se carga en un escritorio con el
 * remito al lado, y ahí «Caja x 21» es un dato de la fila tan legible como la cantidad.
 *
 * Tampoco hay nada de listas de precios ni de faltantes: el backend fuerza la lista a `NULL` cuando
 * la contraparte es un proveedor, y sólo valida stock cuando el comprobante descuenta — los de
 * compra incrementan.
 */
@Component({
  selector: 'app-purchase-cart',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './purchase-cart.component.html',
  styleUrl: './purchase-cart.component.css',
})
export class PurchaseCartComponent {
  private readonly translate = inject(TranslateService);

  readonly lines = input.required<readonly PurchaseCartLineView[]>();

  readonly quantityChange = output<PurchaseQuantityChange>();
  readonly unitCostChange = output<PurchaseUnitCostChange>();
  readonly batchesChange = output<PurchaseBatchesChange>();
  readonly serialsChange = output<PurchaseSerialsChange>();
  /** El empaque con el que se carga una línea: `null` vuelve a unidades sueltas. */
  readonly packagingChange = output<PurchasePackagingChange>();
  readonly lineRemove = output<string>();

  protected readonly displayedColumns = COLUMNS;
  protected readonly batchRowColumns = BATCH_ROW_COLUMNS;
  protected readonly serialRowColumns = SERIAL_ROW_COLUMNS;

  /**
   * Con qué reconoce la tabla que dos renders son la misma fila.
   *
   * Sin esto `mat-table` compara por identidad de objeto, y el carrito rehace la lista entera en
   * cada cambio: escribir un dígito del costo destruía las seis celdas de la fila y las volvía a
   * crear, así que el `<input>` que se estaba tipeando desaparecía con el foco puesto. El producto
   * es la identidad real de la línea —hay una sola por producto—, y con ella la fila se actualiza
   * en lugar de rehacerse.
   */
  protected readonly trackByProduct = (_index: number, line: PurchaseCartLineView): string =>
    line.product.uuid;

  /** Sólo las líneas con partidas tienen la fila de reparto debajo. */
  protected readonly hasBatchRow = (_index: number, line: PurchaseCartLineView): boolean =>
    line.requiresBatches;

  /** Y sólo las serializadas tienen la de series. Una línea puede tener las dos (P9). */
  protected readonly hasSerialRow = (_index: number, line: PurchaseCartLineView): boolean =>
    line.requiresSerials;

  protected readonly trackByBatchKey = (_index: number, batch: PurchaseBatchSplit): string =>
    batch.key;

  /**
   * Con qué salto se mueve la cantidad de la línea: de a uno en un producto que se compra por
   * unidad, de a un gramo en uno que se compra por kilo. Lo declara la unidad del producto, y
   * `'any'` es el producto que no declara ninguna —ahí el navegador acepta cualquier decimal—.
   */
  /**
   * Lo que muestra el input: bultos con empaque elegido, unidades base sin él. La cantidad que el
   * carrito guarda es **siempre** la de unidad base (RN-16) —la que tiene que cuadrar con el reparto
   * en partidas—; esto es sólo en qué unidad se escribe.
   */
  protected displayedQuantity(line: PurchaseCartLineView): number {
    return line.packageQuantity ?? line.quantity;
  }

  /** Los empaques que el producto declara. Vacío esconde el selector. */
  protected packagingOptions(line: PurchaseCartLineView): readonly PurchasePackagingOption[] {
    return line.product.packagings ?? [];
  }

  /** El empaque de la línea que tiene ese uuid; `null` es la opción «sueltas». */
  protected packagingByUuid(
    line: PurchaseCartLineView,
    uuid: string | null,
  ): PurchasePackagingOption | null {
    return uuid ? (this.packagingOptions(line).find((row) => row.uuid === uuid) ?? null) : null;
  }

  /** El nombre de la unidad base, traducido: es cómo se llama la opción «sueltas». */
  protected unitName(line: PurchaseCartLineView): string {
    const unit = line.product.unitMeasure;
    return unit ? this.translate.instant(`products.unitMeasures.${unit}`) : '';
  }

  /**
   * Qué dice la celda de empaque cuando no hay nada que elegir: la unidad en la que se carga la
   * línea, apagada. «Unidad» y no un selector vacío, que sugeriría que faltó cargar algo.
   */
  protected looseLabel(line: PurchaseCartLineView): string {
    return this.unitName(line) || '—';
  }

  /**
   * La equivalencia de la línea, al lado del input: «= 2000 un». Es lo que evita que el número de la
   * fila se lea como unidades cuando en realidad son bultos, y es además la cantidad contra la que
   * el reparto en partidas tiene que cuadrar.
   */
  protected equivalence(line: PurchaseCartLineView): string | null {
    if (!line.packaging) {
      return null;
    }

    return this.translate.instant('purchases.cart.packaging.equivalence', {
      quantity: line.quantity,
      unit: this.unitName(line),
    });
  }

  /** Las series de la línea, una por renglón: es como se pegan y como las deja el lector. */
  protected serialsText(line: PurchaseCartLineView): string {
    return line.serials.join('\n');
  }

  /**
   * Lo pegado, normalizado: un número por renglón, sin espacios ni renglones vacíos.
   *
   * Se emite en cada tecla y no al salir del campo porque el contador «5 de 5» y el bloqueo del
   * botón se leen de la misma lista: si esperara al blur, el operador vería «faltan 5» con las
   * cinco series ya escritas.
   */
  protected onSerialsInput(line: PurchaseCartLineView, value: string): void {
    this.serialsChange.emit({
      productUuid: line.product.uuid,
      serials: value
        .split(/\r?\n/)
        .map((serial) => serial.trim())
        .filter((serial) => serial.length > 0),
    });
  }

  /** Sacar una serie del chip. Baja la cantidad de la línea con ella (RN-17). */
  protected onRemoveSerial(line: PurchaseCartLineView, serial: string): void {
    this.serialsChange.emit({
      productUuid: line.product.uuid,
      serials: line.serials.filter((current) => current !== serial),
    });
  }

  protected onPackagingChange(
    line: PurchaseCartLineView,
    option: PurchasePackagingOption | null,
  ): void {
    this.packagingChange.emit({
      productUuid: line.product.uuid,
      packaging: option ? { uuid: option.uuid, name: option.name, factor: option.factor } : null,
    });
  }

  /** Cuánto sube o baja un paso de los botones: un bulto con empaque, una unidad sin él. */
  private lineStep(line: PurchaseCartLineView): number {
    return line.packaging && line.packaging.factor > 0 ? line.packaging.factor : 1;
  }

  protected step(line: PurchaseCartLineView): number | 'any' {
    // Con empaque el input cuenta bultos: la precisión de la unidad se aplica sobre la cantidad en
    // unidad base que sale de multiplicar, y eso lo hace el carrito.
    return line.packaging ? 'any' : quantityStep(quantityDecimalsOf(line.product));
  }

  /** La cantidad más chica que se puede pedir, la del salto de la unidad. */
  protected min(line: PurchaseCartLineView): number | null {
    return line.packaging ? null : minQuantity(quantityDecimalsOf(line.product));
  }

  /**
   * El `−` hace **una unidad entera o nada**: se apaga cuando bajar una unidad dejaría la línea por
   * debajo del mínimo. En un producto por peso eso significa que a 1,75 kg se puede bajar a 0,75,
   * pero a 0,75 el botón queda apagado en vez de colapsar la línea al gramo mínimo.
   */
  protected canDecrease(line: PurchaseCartLineView): boolean {
    const floor = line.packaging ? null : this.min(line);
    const next = line.quantity - this.lineStep(line);

    return floor === null ? next > 0 : next >= floor;
  }

  /**
   * Los botones mueven de a una unidad y no de a un salto de la precisión: en un producto por kilo,
   * `+` sube de a 1 kg y no de a un gramo. El redondeo final lo hace el carrito, que es el único que
   * sabe a qué precisión ajustar.
   */
  protected onDecrease(line: PurchaseCartLineView): void {
    this.quantityChange.emit({
      productUuid: line.product.uuid,
      quantity: line.quantity - this.lineStep(line),
    });
  }

  protected onIncrease(line: PurchaseCartLineView): void {
    this.quantityChange.emit({
      productUuid: line.product.uuid,
      quantity: line.quantity + this.lineStep(line),
    });
  }

  /**
   * `parseFloat` y no `parseInt`: truncar acá haría que un `0,75` tipeado en un producto que se
   * compra por kilo llegara al carrito como `0`. Quien decide la precisión final es el carrito.
   */
  protected onQuantityInput(line: PurchaseCartLineView, value: string): void {
    const quantity = Number.parseFloat(value);
    if (Number.isNaN(quantity)) {
      return;
    }

    // Lo tipeado son bultos cuando la línea tiene empaque: se convierte acá y lo que sale del
    // componente es siempre la cantidad en unidad base, la única que el carrito guarda.
    this.quantityChange.emit({
      productUuid: line.product.uuid,
      quantity: quantity * this.lineStep(line),
    });
  }

  /**
   * El campo vacío vuelve la línea a "sin costo" en vez de mandar un cero: son dos cosas distintas
   * —un cero es una bonificación que el backend acepta, un vacío es un dato que falta— y confundirlas
   * dejaría pasar una compra a costo cero por no haber terminado de tipear.
   */
  protected onUnitCostInput(line: PurchaseCartLineView, value: string): void {
    const trimmed = value.trim();
    if (trimmed === '') {
      this.unitCostChange.emit({ productUuid: line.product.uuid, unitCost: null });
      return;
    }

    const unitCost = Number.parseFloat(trimmed);
    this.unitCostChange.emit({
      productUuid: line.product.uuid,
      unitCost: Number.isNaN(unitCost) ? null : unitCost,
    });
  }

  // ───────────────────────────  Partidas  ───────────────────────────

  protected showsExpiration(line: PurchaseCartLineView): boolean {
    return acceptsExpiration(line.product);
  }

  protected expirationRequired(line: PurchaseCartLineView): boolean {
    return requiresExpiration(line.product);
  }

  /** Lo que la línea todavía no repartió; es lo que la partida nueva propone de entrada. */
  protected remaining(line: PurchaseCartLineView): number {
    return Math.max(0, roundTo(line.quantity - line.allocatedQuantity, 6));
  }

  /**
   * Abre una partida más, con lo que falta repartir ya cargado: el caso común es «un lote en un
   * renglón», y ahí una sola fila prellena cierra el reparto sin tipear la cantidad.
   */
  protected onAddBatch(line: PurchaseCartLineView): void {
    const remaining = this.remaining(line);

    this.batchesChange.emit({
      productUuid: line.product.uuid,
      batches: [
        ...line.batches,
        {
          key: `b${++batchKeySequence}`,
          batchNumber: '',
          expirationDate: null,
          quantity: remaining > 0 ? remaining : null,
        },
      ],
    });
  }

  protected onBatchNumberInput(line: PurchaseCartLineView, key: string, value: string): void {
    this.emitBatch(line, key, { batchNumber: value });
  }

  protected onBatchExpirationInput(line: PurchaseCartLineView, key: string, value: string): void {
    this.emitBatch(line, key, { expirationDate: value.trim() || null });
  }

  protected onBatchQuantityInput(line: PurchaseCartLineView, key: string, value: string): void {
    const trimmed = value.trim();
    const quantity = trimmed === '' ? null : Number.parseFloat(trimmed);

    this.emitBatch(line, key, {
      quantity: quantity === null || Number.isNaN(quantity) ? null : quantity,
    });
  }

  /**
   * La cantidad de una partida expresada en el empaque de la línea —20 cajas—, o `null` si la
   * partida no tiene cantidad. Con la línea en bultos el remito también viene en bultos (`1o`).
   */
  protected batchPackageQuantity(
    line: PurchaseCartLineView,
    batch: PurchaseBatchSplit,
  ): number | null {
    return batch.quantity === null ? null : packageQuantityOf(batch.quantity, line.packaging);
  }

  /** Lo tipeado son bultos: se convierte acá, y la partida guarda siempre unidad base (RN-16). */
  protected onBatchPackageQuantityInput(
    line: PurchaseCartLineView,
    key: string,
    value: string,
  ): void {
    const trimmed = value.trim();
    const packages = trimmed === '' ? null : Number.parseFloat(trimmed);

    this.emitBatch(line, key, {
      quantity:
        packages === null || Number.isNaN(packages)
          ? null
          : roundTo(packages * this.lineStep(line), 6),
    });
  }

  protected onBatchRemove(line: PurchaseCartLineView, key: string): void {
    this.batchesChange.emit({
      productUuid: line.product.uuid,
      batches: line.batches.filter((batch) => batch.key !== key),
    });
  }

  private emitBatch(
    line: PurchaseCartLineView,
    key: string,
    patch: Partial<Omit<PurchaseBatchSplit, 'key'>>,
  ): void {
    this.batchesChange.emit({
      productUuid: line.product.uuid,
      batches: line.batches.map((batch) => (batch.key === key ? { ...batch, ...patch } : batch)),
    });
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}
