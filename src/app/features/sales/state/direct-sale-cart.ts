import { Signal, computed, signal } from '@angular/core';
import { DEFAULT_PRICE_ROUNDING, PriceRounding } from '../../../core/pricing/price-rounding';
import { clampQuantity, quantityDecimalsOf } from '../../../core/product/quantity-precision';
import {
  PackagingRef,
  baseQuantityOf,
  defaultPackagingOf,
} from '../../../core/product/product-lookup.model';
import {
  OrderReceiver,
  StockShortageDetail,
  StockValidationPolicy,
} from '../../../core/orders/order-commit.model';
import { OrderTotals } from '../../../core/pricing/order-pricing';
import { PromotionLineInput } from '../../../core/pricing/promotion-engine';
import {
  SalePromotionContext,
  SalePromotionRow,
  saleCheckoutOf,
} from './sale-checkout';
import {
  DEFAULT_TAX_RATE,
  SaleCartLine,
  SaleCartLineView,
  SaleCustomerDto,
  SalePaymentMethodDto,
  SalePriceListDto,
  SaleProductDto,
  SaleVoucherDto,
  SaleKitInfo,
  SalePromotionDto,
  addsTax,
  decrementsStock,
  isVirtualKitProduct,
  resolveUnitPrice,
  toCartLineView,
  SaleBatchChoice,
} from '../data-access/sale.model';

/** Un tramo del cobro ya agregado al checkout. */
export interface SalePayment {
  paymentMethod: SalePaymentMethodDto;
  amount: number;
}

/**
 * Tolerancia con la que se compara el cobro contra el total. Los importes son sumas de valores ya
 * redondeados, así que el error de punto flotante es de centésimas: sin holgura, un pago exacto
 * podría quedar "incompleto" por 1e-13.
 */
export const AMOUNT_EPSILON = 0.005;

/** Cómo va el cobro contra el total: lo cobrado, lo que falta, el vuelto y si ya está saldado. */
export interface PaymentBalance {
  paidAmount: number;
  /** Lo que falta cobrar. Negativo es vuelto: se cobró de más. */
  remainingAmount: number;
  changeAmount: number;
  isFullyPaid: boolean;
}

/**
 * La cuenta del cobro, una sola vez y para los dos que la necesitan: el carrito, que decide con
 * ella si la venta se puede mandar, y el diálogo donde se registran los pagos, que la muestra
 * mientras se arman. Que la tolerancia viva en un solo lado es lo que evita que el diálogo dé por
 * saldado un cobro que después el carrito rechaza, o al revés.
 */
export function paymentBalance(
  totalAmount: number,
  payments: readonly SalePayment[],
): PaymentBalance {
  const paidAmount = payments.reduce((total, payment) => total + payment.amount, 0);
  const remainingAmount = totalAmount - paidAmount;

  return {
    paidAmount,
    remainingAmount,
    changeAmount: Math.max(0, -remainingAmount),
    isFullyPaid: remainingAmount <= AMOUNT_EPSILON,
  };
}

/**
 * El carrito de la venta directa: qué se vende, a quién, con qué comprobante y cómo se cobra.
 *
 * No habla con la API. Su única responsabilidad es sostener lo que el operador armó y derivar de
 * ahí los importes y las razones por las que la venta todavía no se puede cerrar; quien llama al
 * commit y muestra los diálogos es la pantalla.
 *
 * Los importes que calcula son una **anticipación** de los del backend (ver `sale-pricing.ts`): el
 * total que vale es el que devuelve el commit.
 */
export class DirectSaleCart {
  private readonly _lines = signal<readonly SaleCartLine[]>([]);
  private readonly _customer = signal<SaleCustomerDto | null>(null);
  private readonly _voucher = signal<SaleVoucherDto | null>(null);
  private readonly _payments = signal<readonly SalePayment[]>([]);
  /**
   * La política de faltantes de la sucursal, o `null` si no se pudo leer. `null` no cae a un
   * default del front: significa que la pantalla no puede anticipar el bloqueo, así que manda el
   * commit y muestra lo que conteste el backend — la misma salida que con un faltante que aparece
   * entre que se leyó el stock y se cobró.
   */
  private readonly _stockValidationPolicy = signal<StockValidationPolicy | null>(null);
  private readonly _priceLists = signal<readonly SalePriceListDto[]>([]);

  /**
   * Fecha y hora reales de la operación, con las que el backend resuelve la sesión de caja. Arranca
   * en el instante en que se abrió la pantalla —que es lo normal en un mostrador— y el operador la
   * corrige cuando carga una venta que ya ocurrió.
   */
  private readonly _dateOperation = signal<Date>(new Date());

  /**
   * La nota de la venta: lo que hace falta para entenderla después y no entra en ningún campo del
   * comprobante —a quién se le entregó, qué se acordó en el mostrador—. Viaja como `observations`
   * en el commit y no toca ningún importe.
   */
  private readonly _observations = signal('');

  /**
   * El receptor del comprobante de esta venta, o `null` mientras nadie lo tocó. Lo arma el diálogo
   * de cobro, que es el momento en que el comprobante se emite.
   *
   * `null` no es «consumidor final»: es «todavía no se decidió». Con `null` el commit no manda el
   * bloque y el backend copia los cuatro campos de la ficha del cliente —o los deja nulos si no hay
   * cliente, y ahí sí sale a consumidor final.
   */
  private readonly _receiver = signal<OrderReceiver | null>(null);

  /**
   * Lista que el operador fijó para **todo** el carrito, o `null` —lo normal— para que cada línea la
   * resuelva con la del cliente. Es una decisión de esta venta y no del mostrador: se suelta al
   * vaciar el carrito, así que la venta siguiente vuelve a arrancar por la lista del cliente en vez
   * de heredar en silencio una que alguien fijó hace media hora.
   */
  private readonly _cartPriceListUuid = signal<string | null>(null);

  /**
   * Criterio de redondeo de cada producto, el que declara la regla que lo alcanza. Es un mapa y no
   * un valor único porque desde `v74` el redondeo es por regla: dos productos del mismo carrito
   * pueden cerrar con criterios distintos. Lo puebla la pantalla a medida que resuelve las reglas;
   * lo que todavía no llegó usa el default, igual que el backend con un producto sin regla.
   */
  private readonly _roundingByProduct = signal<ReadonlyMap<string, PriceRounding>>(new Map());

  /**
   * Composición y disponible derivado de cada kit del carrito. Llega después de agregarlo —el
   * paginado no la trae y el detalle es una lectura aparte—, así que la línea se dibuja primero sin
   * el despliegue y lo suma cuando aterriza, igual que el redondeo.
   *
   * Mientras falta, la línea **no anticipa faltante**: quien valida componente por componente es el
   * backend, y suponer que un kit sin datos está agotado frenaría ventas que se pueden cerrar.
   */
  private readonly _kitByProduct = signal<ReadonlyMap<string, SaleKitInfo>>(new Map());

  /**
   * Las promociones vigentes de la empresa, **de la más antigua a la más nueva**. Las trae la
   * pantalla, igual que las listas de precios y el detalle de los kits: el carrito sigue sin hablar
   * con la API.
   *
   * El orden importa y no es decorativo: es lo que desempata dos NxM de igual fracción bonificada y
   * dos no acumulables de igual descuento (RN-05, RN-06). Del otro lado ese desempate es el id de la
   * fila; acá es la posición.
   */
  private readonly _promotions = signal<readonly SalePromotionDto[]>([]);

  /**
   * El linaje de cada categoría de la empresa —ella misma y sus ancestras—, con el que se resuelve
   * si la línea cae en una promoción cargada sobre una categoría **con todo su subárbol**.
   *
   * Mientras no llegó, una promoción por categoría no alcanza a nadie: es lo mismo que hace el
   * redondeo con la regla que todavía no se leyó. Anticipar un descuento con el árbol a medias
   * mostraría un total que el backend no va a confirmar, que es peor que mostrar el de lista.
   */
  private readonly _categoryChains = signal<ReadonlyMap<string, readonly string[]>>(new Map());

  /**
   * La sucursal en la que se está atendiendo. Contra ella se filtran las promociones restringidas a
   * sucursales puntuales; `null` las deja a todas afuera, porque el motor no puede afirmar que una
   * promoción «de Centro» aplique en una sucursal que no sabe cuál es.
   */
  private readonly _branchUuid = signal<string | null>(null);

  readonly lines = this._lines.asReadonly();
  readonly customer = this._customer.asReadonly();
  readonly voucher = this._voucher.asReadonly();
  readonly payments = this._payments.asReadonly();
  readonly stockValidationPolicy = this._stockValidationPolicy.asReadonly();
  readonly cartPriceListUuid = this._cartPriceListUuid.asReadonly();
  readonly dateOperation = this._dateOperation.asReadonly();
  readonly observations = this._observations.asReadonly();
  readonly receiver = this._receiver.asReadonly();

  /** Lista principal de la empresa: la que vale cuando la venta no tiene cliente. */
  readonly principalPriceList = computed(
    () => this._priceLists().find((list) => list.isPrincipal === true) ?? null,
  );

  /**
   * La lista con la que se valoriza la venta: la preferida del cliente, y **la principal cuando no
   * hay cliente o el cliente no tiene una**.
   *
   * Es la misma precedencia que `OrderCommitContextResolver.resolveSalePriceList`, y no es la caída
   * que se eliminó en la `v83`: eso era una segunda búsqueda en la principal cuando la lista del
   * cliente no tenía precio para el producto. Acá se elige **qué lista aplica**, una sola vez; si
   * esa lista no tiene el producto, no hay precio y la venta se frena, que es lo que hace el
   * backend.
   */
  readonly preferredPriceListUuid = computed(
    () => this._customer()?.priceList?.uuid ?? this.principalPriceList()?.uuid ?? null,
  );

  /**
   * Si el comprobante elegido suma el impuesto sobre el importe de la línea. En `false` —una factura
   * B o C— se cobra el precio de la lista sin discriminar nada, y el IVA del cierre queda en cero a
   * propósito. Cambiar de comprobante recalcula el carrito entero.
   */
  readonly addsTax = computed(() => addsTax(this._voucher()));

  /**
   * Las líneas con sus importes **de lista**: lo que la venta costaría sin promociones.
   *
   * Es la entrada del motor, así que no puede llevar su salida: primero se valorizan las líneas,
   * después se evalúan las promociones sobre ellas, y recién ahí se arman las vistas que la grilla
   * dibuja ({@link lineViews}).
   */
  private readonly baseLineViews: Signal<readonly SaleCartLineView[]> = computed(() => {
    const rounding = this._roundingByProduct();
    const kits = this._kitByProduct();
    const withTax = this.addsTax();

    return this._lines().map((line) =>
      toCartLineView(
        line,
        rounding.get(line.product.uuid) ?? DEFAULT_PRICE_ROUNDING,
        withTax,
        kits.get(line.product.uuid) ?? null,
      ),
    );
  });

  /**
   * Todo lo que el motor mira de esta venta **menos los pagos**: las líneas con precio, las
   * promociones candidatas y las condiciones contra las que se filtran.
   *
   * Es público porque el diálogo de cobro lo consume: ahí los pagos viven en una señal local y sólo
   * salen al confirmar, así que el diálogo necesita poder evaluar la misma venta con **otros** pagos
   * sin tocar el carrito.
   *
   * Las líneas sin precio quedan afuera: no tienen importe sobre el que descontar y la venta ya está
   * frenada por ellas. Los componentes de un kit tampoco entran — no son líneas del carrito, y el
   * motor sólo mira las padre (RN-18).
   */
  readonly promotionContext: Signal<SalePromotionContext> = computed(() => {
    const chains = this._categoryChains();
    const lines: PromotionLineInput[] = [];

    this.baseLineViews().forEach((line, index) => {
      const amounts = line.amounts;
      if (!amounts) {
        return;
      }

      const categoryUuid = line.product.category?.uuid;
      lines.push({
        // El índice **del carrito**, no la posición en este arreglo: es con lo que se vuelve a la
        // fila para colgarle el chip, y es además el criterio de desempate del NxM entre unidades
        // del mismo precio (RN-03).
        index,
        productKey: line.product.uuid,
        categoryKeys: categoryUuid ? (chains.get(categoryUuid) ?? [categoryUuid]) : [],
        quantity: line.quantity,
        unitPrice: amounts.unitPrice,
        net: amounts.netAmount,
        taxAmount: amounts.taxAmount,
        subtotal: amounts.subtotal,
      });
    });

    return {
      lines,
      promotions: this._promotions(),
      operationDate: toLocalDate(this._dateOperation()),
      customerKey: this._customer()?.uuid ?? null,
      branchKey: this._branchUuid(),
    };
  });

  /**
   * La venta ya evaluada: totales descontados, chips por línea y desglose.
   *
   * Es una computada sobre líneas, cliente, comprobante, fecha y pagos, así que no hay que orquestar
   * ningún recálculo: todo lo que ya disparaba un recálculo de totales dispara éste.
   */
  private readonly checkout = computed(() =>
    saleCheckoutOf(
      this.promotionContext(),
      this._payments().map((payment) => payment.paymentMethod.uuid),
    ),
  );

  /**
   * Las líneas como la grilla las dibuja: los importes ya netos de promociones y los chips de las
   * que alcanzaron a cada una.
   *
   * Una línea sin precio conserva su `amounts` en `null` — el motor no la evaluó, porque no había
   * nada que descontar — y sigue frenando la venta por donde ya la frenaba.
   */
  readonly lineViews: Signal<readonly SaleCartLineView[]> = computed(() => {
    const { lineAmounts, linePromotions } = this.checkout();

    return this.baseLineViews().map((line, index) => ({
      ...line,
      amounts: lineAmounts.get(index) ?? line.amounts,
      promotions: linePromotions.get(index) ?? [],
    }));
  });

  readonly totals: Signal<OrderTotals> = computed(() => this.checkout().totals);

  /**
   * Promoción por promoción, cuánto descontó cada una — más las condicionadas que todavía no entraron
   * y las que se cayeron. Es lo que despliega la fila «Descuento» del panel de totales, y lo que
   * contesta «¿por qué me sale esto?» sin llamar a nadie.
   */
  readonly promotionBreakdown: Signal<readonly SalePromotionRow[]> = computed(
    () => this.checkout().breakdown,
  );

  readonly itemCount = computed(() => this._lines().length);

  readonly isEmpty = computed(() => this._lines().length === 0);

  private readonly balance = computed(() =>
    paymentBalance(this.totals().totalAmount, this._payments()),
  );

  readonly paidAmount = computed(() => this.balance().paidAmount);

  /** Lo que falta cobrar. Negativo es vuelto: se cobró de más. */
  readonly remainingAmount = computed(() => this.balance().remainingAmount);

  readonly isFullyPaid = computed(() => this.balance().isFullyPaid);

  readonly changeAmount = computed(() => this.balance().changeAmount);

  /**
   * Líneas que no se pueden vender: sin precio en la lista aplicada, o con precio cero. Las dos
   * necesitan que alguien decida algo —otra lista, o cargar el precio— y ninguna se arregla sola,
   * así que frenan la venta acá en vez de en el 400 del commit.
   */
  /** Líneas cuyo lote elegido a mano no cubre la cantidad: el backend las rechaza, así que se frena acá. */
  readonly linesWithBatchIssues = computed(() =>
    this.lineViews().filter((line) => line.batchShortage > 0),
  );

  /**
   * Líneas a las que todavía les faltan series (RN-17). Frenan el cobro: el backend las rechaza con
   * `SERIAL_COUNT_MISMATCH`, y el mostrador tiene que saber cuál es **antes** de pedirle la tarjeta
   * al cliente.
   */
  readonly linesWithSerialIssues = computed(() =>
    this.lineViews().filter((line) => line.serialShortage > 0),
  );

  readonly unsellableLines = computed(() =>
    this.lineViews().filter((line) => line.priceIssue !== null),
  );

  /**
   * Faltantes anticipados con el `totalStock` de la sucursal, en el mismo formato que el 409 del
   * commit para que el diálogo sea uno solo. Es una estimación: el saldo pudo cambiar entre la
   * búsqueda y el cierre, y quien valida de verdad es el backend.
   */
  readonly shortages = computed<StockShortageDetail[]>(() =>
    this.lineViews()
      .filter((line) => line.shortage > 0)
      .flatMap((line) => {
        // Un kit virtual no tiene saldo: lo que falta es **de un componente**, y es lo que hay que
        // nombrar. Decir «faltan 3 Combo Desayuno» no le dice al mostrador qué reponer; decir
        // «faltan 3 Jugo naranja» sí, y es además lo que va a contestar el backend si igual se
        // manda el commit. El armado no pasa por acá: lo que falta es él, en el estante.
        if (isVirtualKitProduct(line.product)) {
          return line.kitComponents
            .filter((component) => component.shortage > 0)
            .map((component) => ({
              productUuid: component.uuid,
              productName: component.name,
              requestedQuantity: component.requiredQuantity,
              availableQuantity: component.stock ?? 0,
              deficit: component.shortage,
            }));
        }
        return [
          {
            productUuid: line.product.uuid,
            productName: line.product.name,
            requestedQuantity: line.quantity,
            availableQuantity: line.product.totalStock ?? 0,
            deficit: line.shortage,
          },
        ];
      }),
  );

  /**
   * Si la sucursal bloquea las ventas sin stock, un faltante detectado acá ya alcanza para no
   * intentar el commit: el backend respondería 400 con los faltantes redactados dentro del mensaje,
   * y de ahí no se puede armar el detalle que la pantalla ya tiene.
   *
   * Sólo aplica cuando el comprobante **descarga** stock: con una orden de venta o un presupuesto
   * (`stockEffect = NONE`) el backend ni mira el inventario, así que bloquear acá inventaría una
   * restricción que del otro lado no existe.
   *
   * Deliberadamente **fuera** de {@link isReadyToCommit}: la venta está completa, lo que falta es
   * una decisión sobre el faltante. Quien la pide es el diálogo, y para llegar a él hay que poder
   * apretar «Confirmar».
   */
  readonly hasBlockingShortage = computed(
    () =>
      decrementsStock(this._voucher()) &&
      this._stockValidationPolicy() === 'STRICT_BLOCK' &&
      this.shortages().length > 0,
  );

  /**
   * Todo lo que la venta necesita para poder mandarse: líneas con precio, comprobante y cobro.
   *
   * El cliente **no** está en la lista: la venta de mostrador va sin tercero desde que el maestro
   * unificado dejó de tener una fila `Consumidor Final` que lo simulara.
   */
  readonly isReadyToCommit = computed(
    () =>
      !this.isEmpty() &&
      this.unsellableLines().length === 0 &&
      this._voucher() !== null &&
      this._payments().length > 0 &&
      this.isFullyPaid(),
  );

  /**
   * La composición de un kit, resuelta con el detalle del producto. Se guarda por producto y no por
   * línea: el mismo combo escaneado dos veces es la misma composición.
   */
  setKitInfo(productUuid: string, kit: SaleKitInfo): void {
    this._kitByProduct.update((current) => new Map(current).set(productUuid, kit));
  }

  /**
   * Las promociones que el motor va a evaluar, **de la más antigua a la más nueva**. Las trae la
   * pantalla al abrir el punto de venta, una sola vez: son el catálogo de la empresa y no cambian
   * mientras se atiende.
   */
  setPromotions(promotions: readonly SalePromotionDto[]): void {
    this._promotions.set([...promotions]);
  }

  /** El linaje de cada categoría, con el que una promoción por categoría alcanza a su subárbol. */
  setCategoryChains(chains: ReadonlyMap<string, readonly string[]>): void {
    this._categoryChains.set(chains);
  }

  /** La sucursal en la que se está atendiendo: la que decide qué promociones rigen acá. */
  setBranch(branchUuid: string | null): void {
    this._branchUuid.set(branchUuid);
  }

  setStockValidationPolicy(policy: StockValidationPolicy | null): void {
    this._stockValidationPolicy.set(policy);
  }

  setPriceLists(priceLists: readonly SalePriceListDto[]): void {
    this._priceLists.set(priceLists);
    this.repriceLines();
  }

  /**
   * Cambiar de cliente cambia la lista preferida, y con ella el precio de todo lo que ya está en el
   * carrito: se recalcula entero en vez de dejar líneas con el precio del cliente anterior.
   *
   * Se sueltan también las listas fijadas a mano —la del carrito y las de cada línea—: eran
   * decisiones tomadas para el cliente anterior, y arrastrarlas al nuevo es cobrarle una lista que
   * nadie eligió para él.
   */
  setCustomer(customer: SaleCustomerDto | null): void {
    this._customer.set(customer);
    this._cartPriceListUuid.set(null);
    // El receptor cargado era la ficha del cliente anterior. Arrastrarlo facturaría a nombre de
    // quien ya no está comprando, que es peor que volver a precargarlo.
    this._receiver.set(null);
    this.repriceLines(false);
  }

  /**
   * Fija con qué lista se cobra **todo** el carrito. `null` lo devuelve a la del cliente.
   *
   * «Todo» incluye a las líneas que tenían una lista propia: se sueltan, porque si no la acción
   * diría una cosa y haría otra. La elección también alcanza a lo que se agregue después: en un
   * mostrador, «esta venta va por mayorista» se decide una vez y no producto por producto.
   */
  setCartPriceList(priceListUuid: string | null): void {
    this._cartPriceListUuid.set(priceListUuid);
    this.repriceLines(false);
  }

  /**
   * Fija la lista de unas líneas puntuales: la que el operador cambió en su fila, o las que marcó
   * para cambiarlas juntas. `null` las devuelve a la del carrito.
   */
  /**
   * El lote elegido a mano para una línea (§7.3), o `null` para volver a la política de la
   * sucursal. Es por línea y no por carrito: la farmacia elige una partida puntual, no cambia cómo
   * se despacha todo.
   */
  setLineBatch(productUuid: string, batch: SaleBatchChoice | null): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid ? { ...line, chosenBatch: batch } : line,
      ),
    );
  }

  /**
   * Las unidades que se lleva el cliente, por número (§9). A diferencia del lote, elegirlas **no
   * exige `stock.batch_select`**: el operador no eligió una partida, eligió qué notebook se lleva,
   * y el lote vino con ella. Es la misma decisión que toma el backend.
   */
  setLineSerials(productUuid: string, serials: readonly string[]): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid ? { ...line, serials: [...serials] } : line,
      ),
    );
  }

  setLinesPriceList(productUuids: readonly string[], priceListUuid: string | null): void {
    const targets = new Set(productUuids);

    this._lines.update((lines) =>
      lines.map((line) =>
        targets.has(line.product.uuid)
          ? this.buildLine(
              line.product,
              line.quantity,
              priceListUuid,
              line.chosenBatch,
              line.packaging,
              line.serials,
            )
          : line,
      ),
    );
  }

  setVoucher(voucher: SaleVoucherDto | null): void {
    this._voucher.set(voucher);
  }

  /**
   * Cuándo ocurrió la venta. No la suelta {@link clearCart} —vaciar el carrito es corregir lo que se
   * está armando, no empezar otra venta—: quien la devuelve al instante actual es la pantalla, al
   * cerrar el commit.
   */
  setDateOperation(date: Date): void {
    this._dateOperation.set(date);
  }

  /**
   * La nota de esta venta. Como la fecha, sobrevive a {@link clearCart} —vaciar el carrito es
   * corregir la venta que se está armando, y la nota sigue siendo de ella—; quien la suelta es la
   * pantalla, al cerrar el commit.
   */
  setObservations(observations: string): void {
    this._observations.set(observations);
  }

  /**
   * El receptor con el que se va a emitir el comprobante. Como la nota, sobrevive a
   * {@link clearCart} y lo suelta la pantalla al cerrar el commit: describe al comprador de **esta**
   * venta, no al mostrador.
   *
   * Cambiar de cliente lo suelta ({@link setCustomer}): lo que estaba cargado era la ficha del
   * anterior, y arrastrarlo facturaría a nombre de quien ya no está comprando.
   */
  setReceiver(receiver: OrderReceiver | null): void {
    this._receiver.set(receiver);
  }

  /**
   * Criterio con el que se redondean los importes de un producto. Llega después de agregarlo al
   * carrito —la regla se resuelve con una lectura aparte—, así que la línea se dibuja primero con el
   * default y se corrige sola cuando la respuesta entra.
   */
  setProductRounding(productUuid: string, rounding: PriceRounding): void {
    this._roundingByProduct.update((current) => new Map(current).set(productUuid, rounding));
  }

  /**
   * Escanear dos veces el mismo producto suma cantidad; no abre una segunda línea.
   *
   * @param quantity Cantidad en **unidad base**, siempre. Escanear la caja de 12 llega acá como
   *   `12`, no como `1`: la conversión la hizo quien resolvió el código, y el carrito no guarda
   *   otra cosa que unidades base (RN-16).
   * @param packaging El empaque con el que se está cargando, si hay uno. En una línea que ya existe
   *   **no** se pisa el que el operador tenga elegido: sumar una caja más no es cambiar la unidad en
   *   la que estaba escribiendo.
   */
  addProduct(
    product: SaleProductDto,
    quantity = 1,
    packaging: PackagingRef | null = null,
    quantityFromCode = false,
  ): void {
    const existing = this._lines().find((line) => line.product.uuid === product.uuid);

    if (existing) {
      this.setQuantity(product.uuid, existing.quantity + quantity);
      return;
    }

    // Sin empaque explícito, el que el producto declaró por defecto para vender. Lo aplica el front:
    // el backend guarda el flag pero no lo lee, porque la conversión es de quien carga la línea.
    const linePackaging = packaging ?? defaultPackagingOf(product.packagings, 'sale');

    // Con un empaque adoptado por default y una lectura que no trajo cantidad propia, la línea
    // arranca en **un empaque**: el default dice «así lo vendo», y dejar el 1 neutro mostraría una
    // fracción de caja que nadie pidió.
    const initial =
      linePackaging && !packaging && !quantityFromCode
        ? baseQuantityOf(1, linePackaging)
        : quantity;

    // La cantidad se ajusta a la precisión del producto: quien agrega puede venir con una cantidad
    // tipeada —el buscador por peso, la etiqueta de balanza—, y no sólo con el 1 del escaneo.
    this._lines.update((lines) => [
      ...lines,
      this.buildLine(product, clampQuantity(initial, quantityDecimalsOf(product)), null, null, linePackaging),
    ]);
  }

  /**
   * El empaque con el que se carga una línea, o `null` para volver a unidades sueltas.
   *
   * **La cantidad en unidad base no se toca.** Cambiar de «unidad» a «Caja x 12» con 24 en la línea
   * deja 24 unidades = 2 cajas: lo que cambia es en qué unidad se escribe el número, no cuánta
   * mercadería hay. Reconvertir la cantidad haría que elegir el empaque moviera el stock que se
   * está vendiendo, que es justo lo que RN-16 evita.
   */
  /**
   * Carga **una unidad identificada**, leída por su número de serie.
   *
   * Suma la unidad y le anota la serie a la línea en el mismo gesto: en un producto serializado la
   * cantidad de la línea es cuántos números se informaron (RN-17), así que moverlas por separado
   * dejaría el carrito pidiendo series que ya tiene —o vendiendo unidades que nadie identificó—.
   *
   * Leer dos veces la misma unidad no la duplica: es la misma unidad. Y la cantidad nunca baja: si
   * el operador ya había pedido tres y recién identifica la primera, siguen siendo tres —faltan dos
   * series, que es exactamente lo que el carrito informa—.
   */
  addSerial(product: SaleProductDto, serialNumber: string): void {
    const existing = this._lines().find((line) => line.product.uuid === product.uuid);

    if (!existing) {
      this._lines.update((lines) => [
        ...lines,
        this.buildLine(product, 1, null, null, null, [serialNumber]),
      ]);
      return;
    }

    if (existing.serials.includes(serialNumber)) {
      return;
    }

    const serials = [...existing.serials, serialNumber];

    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === product.uuid
          ? { ...line, quantity: Math.max(line.quantity, serials.length), serials }
          : line,
      ),
    );
  }

  setLinePackaging(productUuid: string, packaging: PackagingRef | null): void {
    this._lines.update((lines) =>
      lines.map((line) => (line.product.uuid === productUuid ? { ...line, packaging } : line)),
    );
  }

  /**
   * La cantidad expresada en el empaque de la línea: 2 cajas se guardan como 24 unidades. Sin
   * empaque es {@link setQuantity} a secas.
   */
  setPackageQuantity(productUuid: string, packageQuantity: number): void {
    const line = this._lines().find((row) => row.product.uuid === productUuid);
    if (!line) {
      return;
    }

    this.setQuantity(productUuid, baseQuantityOf(packageQuantity, line.packaging));
  }

  /**
   * La cantidad se ajusta a la precisión que declara la unidad del producto: un producto que se vende
   * por unidad queda en enteros, y uno que se vende por kilo admite el 0,75 que antes se truncaba a 0
   * —y de ahí al mínimo de 1—, que era lo que hacía imposible vender por peso.
   */
  setQuantity(productUuid: string, quantity: number): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        line.product.uuid === productUuid
          ? { ...line, quantity: clampQuantity(quantity, quantityDecimalsOf(line.product)) }
          : line,
      ),
    );
  }

  removeLine(productUuid: string): void {
    this.removeLines([productUuid]);
  }

  /** Saca varias de una: lo que el operador marcó y decidió que no va. */
  removeLines(productUuids: readonly string[]): void {
    const targets = new Set(productUuids);

    this._lines.update((lines) => lines.filter((line) => !targets.has(line.product.uuid)));
  }

  /**
   * Reemplaza el cobro entero por el que se armó en el diálogo. Es el único camino por el que hoy
   * entran los pagos a una venta: se registran todos juntos ahí y recién entonces llegan acá, sobre
   * el filo del commit.
   */
  setPayments(payments: readonly SalePayment[]): void {
    this._payments.set([...payments]);
  }

  addPayment(paymentMethod: SalePaymentMethodDto, amount: number): void {
    this._payments.update((payments) => [...payments, { paymentMethod, amount }]);
  }

  removePayment(index: number): void {
    this._payments.update((payments) => payments.filter((_, position) => position !== index));
  }

  /** Vacía las líneas y los pagos. El cliente y el comprobante quedan para la venta siguiente. */
  clearCart(): void {
    this._lines.set([]);
    this._payments.set([]);
    this._cartPriceListUuid.set(null);
  }

  private buildLine(
    product: SaleProductDto,
    quantity: number,
    chosenPriceListUuid: string | null,
    chosenBatch: SaleBatchChoice | null = null,
    packaging: PackagingRef | null = null,
    serials: readonly string[] = [],
  ): SaleCartLine {
    const resolved = this.resolvePrice(product, chosenPriceListUuid);

    return {
      product,
      quantity,
      unitPrice: resolved?.unitPrice ?? null,
      priceListUuid: resolved?.priceListUuid ?? null,
      chosenPriceListUuid,
      taxRate: product.taxRate ?? DEFAULT_TAX_RATE,
      chosenBatch,
      // Recalcular el precio no cambia qué unidad se lleva el cliente: las series sobreviven al
      // repricing igual que el lote elegido a mano.
      serials: [...serials],
      packaging,
    };
  }

  /**
   * Con qué lista se le pone precio a un producto, en orden: la que el operador fijó para la línea,
   * la que fijó para el carrito, y la del cliente.
   *
   * Ninguna cae a la lista principal. La caída existía hasta la `v83` y la gobernaba una
   * configuración; el backend la eliminó y hoy responde `400` en el checkout, así que simularla acá
   * mostraría un precio con el que la venta no cierra. Si la lista elegida no tiene el producto, la
   * línea queda sin precio y la venta se frena — que es justamente lo que hace visible que ese
   * producto no está en esa lista.
   */
  private resolvePrice(product: SaleProductDto, chosenPriceListUuid: string | null) {
    const chosen = chosenPriceListUuid ?? this._cartPriceListUuid();
    return resolveUnitPrice(product, chosen ?? this.preferredPriceListUuid());
  }

  /**
   * @param keepChoices Si las listas fijadas a mano sobreviven. Sobreviven cuando lo que cambió es
   *   un dato del contexto (el catálogo de listas); no, cuando cambió quien decide el precio.
   */
  private repriceLines(keepChoices = true): void {
    this._lines.update((lines) =>
      lines.map((line) =>
        this.buildLine(
          line.product,
          line.quantity,
          keepChoices ? line.chosenPriceListUuid : null,
          line.chosenBatch,
          line.packaging,
          line.serials,
        ),
      ),
    );
  }
}

/**
 * El día de un instante, en hora local (`YYYY-MM-DD`).
 *
 * A mano y no con `toISOString()`, por lo mismo que `toLocalDateTime`: ese convierte a UTC, y una
 * venta de las nueve de la noche en GMT-3 se evaluaría contra el día siguiente — apagando una
 * promoción que vence hoy, o encendiendo una que empieza mañana.
 */
function toLocalDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
