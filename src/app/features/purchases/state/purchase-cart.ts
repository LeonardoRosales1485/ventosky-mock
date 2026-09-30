import { Signal, computed, signal } from '@angular/core';
import { OrderTotals, sumTotals } from '../../../core/pricing/order-pricing';
import { DEFAULT_PRICE_ROUNDING, PriceRounding } from '../../../core/pricing/price-rounding';
import { clampQuantity, quantityDecimalsOf } from '../../../core/product/quantity-precision';
import {
  PackagingRef,
  baseQuantityOf,
  defaultPackagingOf,
} from '../../../core/product/product-lookup.model';
import {
  DEFAULT_TAX_RATE,
  PurchaseBatchSplit,
  PurchasePackagingOption,
  PurchaseCartLine,
  PurchaseCartLineView,
  PurchasePaymentMethodDto,
  PurchaseProductDto,
  PurchaseSupplierDto,
  PurchaseVoucherDto,
  addsTax,
  requiresPayment,
  toPurchaseCartLineView,
} from '../data-access/purchase.model';

/** Un tramo del pago ya agregado al checkout. */
export interface PurchasePayment {
  paymentMethod: PurchasePaymentMethodDto;
  amount: number;
}

/**
 * Tolerancia con la que se compara lo pagado contra el total. Los importes son sumas de valores ya
 * redondeados, así que el error de punto flotante es de centésimas: sin holgura, un pago exacto
 * podría quedar "incompleto" por 1e-13.
 */
const AMOUNT_EPSILON = 0.005;

/**
 * El carrito de la compra: qué se compra, a quién, con qué comprobante, cuándo y cómo se paga.
 *
 * No habla con la API. Su única responsabilidad es sostener lo que el operador armó y derivar de
 * ahí los importes y las razones por las que la compra todavía no se puede cerrar; quien llama al
 * commit es la pantalla.
 *
 * Es el gemelo de `DirectSaleCart` con dos diferencias de fondo, las mismas que tiene el backend:
 * el importe unitario es el **costo que declara el operador** en vez de un precio que resuelve una
 * lista —de ahí que no haya nada de listas acá—, y el comprobante **suma** stock, así que no hay
 * faltantes que anticipar ni que bloquear.
 *
 * Los importes que calcula son una **anticipación** de los del backend (ver
 * `core/pricing/order-pricing.ts`): el total que vale es el que devuelve el commit.
 */
export class PurchaseCart {
  private readonly _lines = signal<readonly PurchaseCartLine[]>([]);
  private readonly _supplier = signal<PurchaseSupplierDto | null>(null);
  private readonly _voucher = signal<PurchaseVoucherDto | null>(null);
  private readonly _payments = signal<readonly PurchasePayment[]>([]);

  /**
   * Fecha y hora reales de la operación, con las que el backend resuelve la sesión de caja. Arranca
   * en el instante en que se abrió la pantalla y el operador la corrige: una compra se suele cargar
   * después, contra la fecha del comprobante del proveedor.
   */
  private readonly _dateOperation = signal<Date>(new Date());

  /**
   * La nota de la compra: lo que el comprobante del proveedor no dice y hace falta para entenderla
   * después —un faltante recibido, un precio que no coincide con lo acordado—. Viaja como
   * `observations` en el commit y no participa de ningún importe.
   */
  private readonly _observations = signal('');

  /**
   * Criterio de redondeo de cada producto, el que declara la regla que lo alcanza. Es un mapa y no
   * un valor único porque desde `v74` el redondeo es por regla: dos productos de la misma compra
   * pueden cerrar con criterios distintos. Lo puebla la pantalla a medida que resuelve las reglas;
   * lo que todavía no llegó usa el default, igual que el backend con un producto sin regla.
   */
  private readonly _roundingByProduct = signal<ReadonlyMap<string, PriceRounding>>(new Map());

  readonly lines = this._lines.asReadonly();
  readonly supplier = this._supplier.asReadonly();
  readonly voucher = this._voucher.asReadonly();
  readonly payments = this._payments.asReadonly();
  readonly dateOperation = this._dateOperation.asReadonly();
  readonly observations = this._observations.asReadonly();

  /** Si el comprobante elegido suma el impuesto sobre el costo de la línea. */
  readonly addsTax = computed(() => addsTax(this._voucher()));

  /**
   * Si esta compra se paga. Una orden de compra o un presupuesto no mueven la cuenta del proveedor:
   * el backend rechaza el commit si le llegan pagos, así que la pantalla ni los pide ni los manda.
   */
  readonly requiresPayment = computed(() => requiresPayment(this._voucher()));

  readonly lineViews: Signal<readonly PurchaseCartLineView[]> = computed(() => {
    const rounding = this._roundingByProduct();
    const withTax = this.addsTax();

    return this._lines().map((line) =>
      toPurchaseCartLineView(
        line,
        rounding.get(line.product.uuid) ?? DEFAULT_PRICE_ROUNDING,
        withTax,
      ),
    );
  });

  readonly totals: Signal<OrderTotals> = computed(() =>
    sumTotals(
      this.lineViews()
        .map((line) => line.amounts)
        .filter((amounts) => amounts !== null),
    ),
  );

  readonly itemCount = computed(() => this._lines().length);
  readonly isEmpty = computed(() => this._lines().length === 0);

  /** Líneas a las que todavía les falta el costo: el backend rechaza la compra sin él. */
  readonly linesWithoutCost = computed(() => this.lineViews().filter((line) => line.missingCost));

  /**
   * Líneas con partidas cuyo reparto no cierra: sin partidas, sin número, sin vencimiento cuando se
   * exige, o que no suman la cantidad. Cada una es un 400 del commit, así que se frena antes.
   */
  readonly linesWithBatchIssues = computed(() =>
    this.lineViews().filter((line) => line.batchIssue !== null),
  );

  /** Las líneas cuyas series todavía no cierran (RN-17). Traban el commit igual que las partidas. */
  readonly linesWithSerialIssues = computed(() =>
    this.lineViews().filter((line) => line.serialIssue !== null),
  );

  readonly paidAmount = computed(() =>
    this._payments().reduce((total, payment) => total + payment.amount, 0),
  );

  readonly remainingAmount = computed(() => this.totals().totalAmount - this.paidAmount());

  readonly isFullyPaid = computed(
    () => !this.requiresPayment() || this.remainingAmount() <= AMOUNT_EPSILON,
  );

  /** Lo que se pagó de más, si el reparto entre medios se pasó del total. */
  readonly changeAmount = computed(() => Math.max(0, -this.remainingAmount()));

  /**
   * Si la compra está lista para commitear. Deja afuera lo que no depende del carrito —el permiso y
   * la sesión de caja—, que los resuelve la pantalla.
   */
  readonly isReadyToCommit = computed(
    () =>
      !this.isEmpty() &&
      this.linesWithoutCost().length === 0 &&
      this.linesWithBatchIssues().length === 0 &&
      this.linesWithSerialIssues().length === 0 &&
      this._supplier() !== null &&
      this._voucher() !== null &&
      (!this.requiresPayment() || this._payments().length > 0) &&
      this.isFullyPaid(),
  );

  setSupplier(supplier: PurchaseSupplierDto | null): void {
    this._supplier.set(supplier);
  }

  /**
   * Cambia el comprobante y, si el nuevo no admite pago, se lleva puestos los que hubiera cargados:
   * mandarlos igual sería un 400 del commit, y dejarlos a la vista sugiere que van a registrarse.
   */
  setVoucher(voucher: PurchaseVoucherDto | null): void {
    this._voucher.set(voucher);

    if (!requiresPayment(voucher)) {
      this._payments.set([]);
    }
  }

  setDateOperation(date: Date): void {
    this._dateOperation.set(date);
  }

  setObservations(observations: string): void {
    this._observations.set(observations);
  }

  setProductRounding(productUuid: string, rounding: PriceRounding): void {
    this._roundingByProduct.update((current) => new Map(current).set(productUuid, rounding));
  }

  /**
   * Agrega el producto, o le suma la cantidad si ya está en el carrito —leer dos veces el mismo
   * código son dos unidades del mismo renglón, no dos renglones—.
   *
   * En ese caso el costo ya cargado se conserva: el operador lo escribió para esta compra, y
   * pisarlo con el costo propuesto le borraría lo que acaba de tipear.
   */
  addProduct(
    product: PurchaseProductDto,
    quantity = 1,
    unitCost: number | null = null,
    packaging: PackagingRef | null = null,
    quantityFromCode = false,
  ): void {
    const existing = this._lines().find((line) => line.product.uuid === product.uuid);
    if (existing) {
      this.setQuantity(product.uuid, existing.quantity + quantity);
      return;
    }

    // Sin empaque explícito, el que el producto declaró por defecto para comprar: es el bulto con el
    // que llega el remito. Lo aplica el front; el backend guarda el flag pero no lo lee.
    const linePackaging = packaging ?? defaultPackagingOf(product.packagings, 'purchase');

    // Con el bulto adoptado por default y una lectura que no trajo cantidad propia, la línea arranca
    // en **un bulto**: es la unidad en la que se compra. Dejar el 1 neutro mostraba «0,001 bultos»,
    // que es la cantidad correcta dicha de la forma más inútil posible.
    const initial =
      linePackaging && !packaging && !quantityFromCode
        ? baseQuantityOf(1, linePackaging)
        : quantity;

    this._lines.update((lines) => [
      ...lines,
      {
        product,
        quantity: clampQuantity(initial, quantityDecimalsOf(product)),
        unitCost,
        taxRate: product.taxRate ?? DEFAULT_TAX_RATE,
        batches: [],
        serials: [],
        packaging: linePackaging,
        explicitQuantity: quantityFromCode,
      },
    ]);
  }

  /**
   * Los empaques que el producto declara, que llegan **después** de la línea: el paginado no los
   * trae y los completa la lectura del detalle. Con ellos la fila estrena el selector y, si la línea
   * todavía está en su cantidad inicial, adopta el empaque por defecto de compra.
   *
   * La cantidad sólo se recalcula cuando la línea **no** venía con empaque y sigue en el 1 neutro
   * del buscador: si el operador ya escribió una cantidad, ya eligió un empaque, o la cantidad
   * vino fijada —una celda de la grilla por modelo, una lectura con cantidad propia—, no se le toca
   * nada.
   */
  setProductPackagings(
    productUuid: string,
    packagings: readonly PurchasePackagingOption[],
  ): void {
    this._lines.update((lines) =>
      lines.map((line) => {
        if (line.product.uuid !== productUuid) {
          return line;
        }

        const product = { ...line.product, packagings };
        if (line.packaging || line.explicitQuantity || line.quantity !== 1) {
          return { ...line, product };
        }

        const fallback = defaultPackagingOf(packagings, 'purchase');
        return {
          ...line,
          product,
          packaging: fallback,
          quantity: fallback
            ? clampQuantity(baseQuantityOf(1, fallback), quantityDecimalsOf(product))
            : line.quantity,
        };
      }),
    );
  }

  /**
   * El empaque con el que se carga una línea, o `null` para volver a unidades sueltas.
   *
   * **La cantidad en unidad base no se toca**: cambiar de «unidad» a «Bulto x 100» con 200 en la
   * línea deja 200 unidades = 2 bultos. Lo que cambia es en qué unidad se escribe el número, no
   * cuánta mercadería entra — y el reparto en partidas, que tiene que cuadrar con la cantidad base,
   * sigue cuadrando.
   */
  setLinePackaging(productUuid: string, packaging: PackagingRef | null): void {
    this._lines.update((lines) =>
      lines.map((line) => (line.product.uuid === productUuid ? { ...line, packaging } : line)),
    );
  }

  /**
   * La cantidad expresada en el empaque de la línea: 2 bultos de 100 se guardan como 200 unidades.
   * Sin empaque es {@link setQuantity} a secas.
   */
  setPackageQuantity(productUuid: string, packageQuantity: number): void {
    const line = this._lines().find((row) => row.product.uuid === productUuid);
    if (!line) {
      return;
    }

    this.setQuantity(productUuid, baseQuantityOf(packageQuantity, line.packaging));
  }

  /**
   * El reparto en partidas de una línea (§7.2): cómo llega el remito, dos lotes en un renglón. Se
   * reemplaza entero; quien edita una fila manda la lista completa.
   */
  setBatches(productUuid: string, batches: readonly PurchaseBatchSplit[]): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid ? { ...line, batches: [...batches] } : line,
      ),
    );
  }

  /**
   * Las series de la línea, y **con ellas la cantidad**: en este eje no son dos números que hay que
   * mantener iguales (RN-17), es el mismo número escrito de dos maneras. Pegar cinco series deja la
   * línea en 5; borrar una la deja en 4. Así el contador «5 de 5» del wireframe no puede mentir.
   */
  setSerials(productUuid: string, serials: readonly string[]): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid
          ? { ...line, serials: [...serials], quantity: serials.length }
          : line,
      ),
    );
  }

  setQuantity(productUuid: string, quantity: number): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid
          ? { ...line, quantity: clampQuantity(quantity, quantityDecimalsOf(line.product)) }
          : line,
      ),
    );
  }

  /**
   * El costo por unidad que declara el operador. Es lo que en venta resuelve la lista de precios, y
   * acá lo escribe una persona: es el dato central de la pantalla.
   *
   * Un negativo se guarda como `null` —"sin cargar"— en vez de dejar pasar un número que el backend
   * va a rechazar con un 400 al commitear.
   */
  setUnitCost(productUuid: string, unitCost: number | null): void {
    const value = unitCost === null || unitCost < 0 ? null : unitCost;

    this._lines.update((lines) =>
      lines.map((line) => (line.product.uuid === productUuid ? { ...line, unitCost: value } : line)),
    );
  }

  /**
   * Propone un costo para el producto sin pisar lo que el operador ya escribió. La pantalla lo llama
   * cuando llega el costo actual del producto, que viaja después de haberlo agregado.
   */
  suggestUnitCost(productUuid: string, unitCost: number): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid && line.unitCost === null
          ? { ...line, unitCost }
          : line,
      ),
    );
  }

  removeLine(productUuid: string): void {
    this._lines.update((lines) => lines.filter((line) => line.product.uuid !== productUuid));
  }

  addPayment(paymentMethod: PurchasePaymentMethodDto, amount: number): void {
    this._payments.update((payments) => [...payments, { paymentMethod, amount }]);
  }

  removePayment(index: number): void {
    this._payments.update((payments) => payments.filter((_, position) => position !== index));
  }

  /**
   * Vacía la compra cerrada y deja la pantalla lista para la siguiente.
   *
   * El proveedor, el comprobante y la fecha **sobreviven**: quien carga compras suele descargar
   * varios comprobantes del mismo proveedor de una sentada, y volver a elegirlos en cada una sería
   * repetir el mismo trabajo.
   */
  clearCart(): void {
    this._lines.set([]);
    this._payments.set([]);
    // La nota sí se va: describe la compra que se acaba de cerrar, no al proveedor.
    this._observations.set('');
  }
}
