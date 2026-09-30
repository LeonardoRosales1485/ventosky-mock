import { Permissions } from '../../../core/auth/permissions';
import { UuidNameRef } from '../../../core/http/api-refs';
import { PackagingRef, packageQuantityOf } from '../../../core/product/product-lookup.model';
import { PriceRounding } from '../../../core/pricing/price-rounding';
import { LineAmounts, computeLineAmounts } from '../../../core/pricing/order-pricing';
import { PromotionCandidate } from '../../../core/pricing/promotion-engine';

/**
 * La referencia mínima con la que viaja todo lo que la venta sólo nombra. Se declara en `core/`
 * —la comparten las órdenes y las cajas— y se re-exporta acá para que el feature siga teniendo un
 * único lugar de donde importar sus tipos.
 */
export type { UuidNameRef };

/** Precio del producto en una lista, en la sucursal activa (`ProductPriceListEntryDTO`). */
export interface SalePriceListEntry {
  priceListUuid: string;
  price: number | null;
}

/**
 * Producto tal como lo ve el punto de venta: la fila de `POST /product/paginate`, que ya viene
 * acotada a la sucursal activa y trae en un solo viaje todo lo que hace falta para armar la línea
 * —precio por lista, impuesto y stock—.
 */
export interface SaleProductDto {
  /**
   * El modelo que agrupa a esta variante, o ausente en un producto suelto (RN-11).
   *
   * Es lo que permite mostrar el modelo **una sola vez** en el buscador: doce variantes que inundan
   * la lista son doce filas que el operador tiene que leer con el cliente esperando.
   */
  model?: { uuid: string; name: string } | null;
  /** Qué valor fija la variante en cada eje: «Talle: M». Vacío en un producto sin modelo. */
  variantValues?: {
    optionValueUuid?: string;
    optionUuid?: string;
    optionName?: string;
    value?: string;
    code?: string | null;
  }[] | null;
  uuid: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  /**
   * La categoría del producto, que es una sola (`products.id_category`, FK opcional). El motor de
   * promociones la necesita porque una promoción puede alcanzar **una categoría con todo su
   * subárbol**: con ella y el linaje que resuelve el carrito, «es de Bebidas» se contesta sin
   * consultar nada.
   *
   * Viaja en las tres lecturas con las que entra un producto al carrito: el paginado, la resolución
   * por código y el detalle por uuid.
   */
  category?: UuidNameRef | null;
  unitMeasure?: string | null;
  /**
   * Decimales que admite la cantidad de la línea, derivados de la unidad del producto. `0` es el
   * producto que se vende de a enteros. Ver `core/product/quantity-precision.ts`.
   */
  unitDecimalPlaces?: number | null;
  taxRate?: number | null;
  isForSale?: boolean | null;
  /** Saldo en la sucursal activa. Es el número contra el que se anticipa el faltante. */
  totalStock?: number | null;
  priceListEntries?: SalePriceListEntry[] | null;
  /**
   * Eje de existencias (`NONE` | `QUANTITY` | `BATCH` | `SERIAL`). Con `BATCH` la línea muestra de
   * qué partida sale y, con permiso, deja elegir otra (§7.3).
   */
  stockTracking?: string | null;
  /**
   * Naturaleza (`SIMPLE` | `KIT` | `SERVICE`). Sólo el kit **virtual** despliega la línea y muestra
   * qué trae el combo: el comprobante emite la padre y el inventario mueve las hijas (RN-08). Ver
   * {@link kitMode}.
   */
  type?: string | null;
  /**
   * Modo del kit (`EXPLODE` | `ASSEMBLE`); ausente fuera de un `type = KIT`, y un kit anterior a la
   * Entrega G se lee como `EXPLODE`.
   *
   * **Es lo que decide si la línea se explota.** Un kit armado ya existe como unidad en el estante:
   * su línea es común —descuenta su propio `totalStock`, no lista componentes y lleva su alícuota—
   * y el backend hace exactamente eso en el commit (RN-22). Sin este campo el POS anticipaba un
   * faltante de componentes que nunca iba a llegar, y con la sucursal en `STRICT_BLOCK` frenaba una
   * venta que del otro lado cerraba sin problema.
   *
   * Viaja en las tres lecturas con las que entra un producto al carrito: el paginado
   * —sugerencias y selector avanzado, desde el backend `6.4.0`—, `GET /product/by-barcode` y
   * `GET /product/uuid/{uuid}`.
   */
  kitMode?: string | null;
  /**
   * Empaques declarados del producto, con los que la línea ofrece el selector. **No** vienen en el
   * paginado —`ProductPaginateDTO` no los trae—: los completa la resolución por código
   * (`GET /product/by-barcode`), que devuelve el `ProductDTO` entero. Un producto elegido del
   * buscador llega sin ellos y la línea no muestra selector, que es lo correcto: mostrar uno vacío
   * diría que el producto no tiene empaques cuando lo que pasa es que no se leyeron.
   */
  packagings?: readonly SalePackagingOption[] | null;
}

/** Un empaque ofrecido en la línea, tal como lo devuelve `GET /product/by-barcode`. */
export interface SalePackagingOption extends PackagingRef {
  isSaleDefault?: boolean | null;
}

/**
 * El empaque de una línea. Se re-exporta desde `core` —lo comparten el POS y la compra— para que el
 * feature siga teniendo un único lugar de donde importar sus tipos.
 */
export type { PackagingRef };

/** Si el producto lleva partidas: la venta las muestra y, con `stock.batch_select`, las elige. */
export function isBatchTracked(product: Pick<SaleProductDto, 'stockTracking'>): boolean {
  return product.stockTracking === 'BATCH';
}

/**
 * Una razón por la que la venta no se puede cobrar todavía.
 *
 * Casi todas son una clave suelta —siempre dicen lo mismo—, pero algunas nombran a la línea que
 * falta: «Falta elegir 1 serie de Notebook Aureo 14"». Sin el nombre, el mostrador tiene que buscar
 * cuál de las diez líneas es la que traba el cobro.
 */
export type SaleBlockingReason = string | { key: string; params: Record<string, unknown> };

/**
 * Si el producto lleva números de serie: cada unidad es una fila de `stock_serials` y la venta
 * obliga a elegir cuáles se lleva el cliente (§9, RN-17).
 */
export function isSerialTracked(product: Pick<SaleProductDto, 'stockTracking'>): boolean {
  return product.stockTracking === 'SERIAL';
}

/**
 * Un combo **virtual**: se explota al vender y su disponible sale de los componentes, no de un saldo
 * (RN-07, RN-08). Es la única pregunta que el POS necesita hacer sobre un kit.
 *
 * El kit **armado** contesta `false` a propósito: es un producto con existencias propias que se
 * vende sin explotar (RN-22), así que todo lo que el mostrador ve de él —el faltante, la alícuota,
 * el lote— sale del camino común. Preguntar `type === 'KIT'` acá los confundía a los dos.
 */
export function isVirtualKitProduct(product: Pick<SaleProductDto, 'type' | 'kitMode'>): boolean {
  return product.type === 'KIT' && (product.kitMode ?? 'EXPLODE') === 'EXPLODE';
}

/**
 * Si el producto participa del inventario. Un servicio y un kit **virtual** no: su `totalStock`
 * viene en `null` —no aplica— y compararlo contra la cantidad pedida inventaría un faltante que no
 * existe. El armado sí participa, y por eso se pregunta por el eje y no por el tipo.
 */
export function tracksStock(product: Pick<SaleProductDto, 'stockTracking'>): boolean {
  return product.stockTracking !== 'NONE';
}

/**
 * Un componente de un kit, tal como lo devuelve el detalle del producto: qué entra, cuánto y con
 * cuánto saldo cuenta.
 *
 * `stock` en `null` es el componente que **no lleva stock** —un servicio dentro del combo—: no
 * limita la disponibilidad del kit (RN-07), y decirlo es distinto de mostrar un cero.
 */
export interface SaleKitComponent {
  uuid: string;
  name: string;
  /** Cuántas unidades entran en **un** kit. La línea hija lleva esto × la cantidad del kit. */
  quantity: number;
  stock: number | null;
  limitsAvailability: boolean;
}

/**
 * Lo que el POS necesita saber de un kit para venderlo: para cuántos alcanza el stock de hoy y qué
 * trae. No viene en el paginado —derivarlo por fila costaría una consulta por kit en cada página—:
 * se pide con el detalle del producto al agregarlo al carrito, una sola vez por producto.
 */
export interface SaleKitInfo {
  /** `mín ⌊stock(componente) / cantidad⌋`; `null` cuando ningún componente limita. */
  availability: number | null;
  components: readonly SaleKitComponent[];
}

/**
 * El lote que el operador eligió a mano para una línea (§7.3). Lo normal es `null`: lo asigna la
 * política de la sucursal (FEFO / FIFO / prioridad) y la pantalla lo muestra al cerrar.
 */
export interface SaleBatchChoice {
  uuid: string;
  batchNumber?: string | null;
  /** `yyyy-MM-dd`. */
  expirationDate?: string | null;
  expirationStatus?: 'EXPIRED' | 'WARNING' | 'OK' | null;
  daysToExpiration?: number | null;
  warehouse?: UuidNameRef | null;
  /** Saldo del lote al elegirlo: la línea no puede pedirle más. */
  quantity: number;
}

/** Lista de precios candidata (`POST /price-list/paginate`). */
export interface SalePriceListDto {
  uuid: string;
  name: string;
  isPrincipal?: boolean | null;
  isActive?: boolean | null;
  /** Lista reservada `Costo`: el backend rechaza usarla como lista de una línea de venta. */
  isCost?: boolean | null;
}

/**
 * Cliente del select (`POST /party/customer/paginate`): el rol `CUSTOMER` del maestro unificado.
 *
 * Ya no hay «cliente por defecto»: el default es **ningún** cliente. La venta de mostrador va sin
 * tercero, y la fila sentinela `Consumidor Final` que lo simulaba dejó de existir.
 */
export interface SaleCustomerDto {
  uuid: string;
  name: string;
  docType?: string | null;
  docNumber?: string | null;
  /**
   * Condición frente al IVA. No interviene en el precio: se lee para **precargar el receptor** del
   * comprobante, que se congela en la orden al cerrar la venta.
   */
  taxCondition?: string | null;
  /** Lista preferida del cliente: manda sobre la principal al resolver el precio. */
  priceList?: UuidNameRef | null;
}

/** Medio de pago habilitado (`POST /payment-method/paginate`). */
export interface SalePaymentMethodDto {
  uuid: string;
  name: string;
  /** `CASH`, `CARD`, `TRANSFER`, `ACCOUNT` o el código libre de un medio personalizado. */
  code?: string | null;
  affectsCashRegister?: boolean | null;
}

/** Efectos que un comprobante declara (`VoucherEffect`). */
export type VoucherEffect = 'NONE' | 'INCREMENT' | 'DECREMENT';

/** Sentido comercial que declara el comprobante (`VoucherOperation`, `v73`). */
export type VoucherOperation = 'PURCHASE' | 'SALE';

/**
 * Comprobante del catálogo de la empresa (`POST /voucher/paginate`). Nombre y lógica viven en la
 * misma fila: el backend fusionó `voucher_type` dentro de `voucher`, así que ya no hay un tipo
 * aparte al que apuntar.
 */
export interface SaleVoucherDto {
  uuid: string;
  /** Identificador dentro de la empresa (`SALE_INVOICE_A`, `SALE_DELIVERY_NOTE`…). */
  code?: string | null;
  name: string;
  /**
   * `PURCHASE` o `SALE`: qué operación cierra el comprobante. Es lo único que la distingue —la orden
   * no tiene campo `type`— y el commit exige la contraparte que le corresponde.
   */
  operationType?: VoucherOperation | string | null;
  /** `DECREMENT` egresa stock; es lo que convierte al comprobante en una venta que descarga. */
  stockEffect?: VoucherEffect | string | null;
  /** `INCREMENT` es un ingreso para la empresa: lo natural de una venta. */
  balanceEffect?: VoucherEffect | string | null;
  /** Informativo: hoy la numeración sale de `last_public_id` de la sucursal en todos los casos. */
  isFiscal?: boolean | null;
  /**
   * Si el impuesto se suma al importe de la línea. `true` (default del backend) discrimina el IVA y
   * lo agrega al neto —una factura A—; `false` cobra el importe de la lista sin agregar nada, que es
   * lo que corresponde a una factura B o C.
   */
  addsTax?: boolean | null;
}

/**
 * La regla de precio efectiva de un producto (`GET /price-rule/product/{uuid}`), de la que al
 * mostrador sólo le interesa el criterio de redondeo: el porcentaje ya está aplicado en el precio de
 * lista que se cobra. Sin regla el backend responde `204`, que el cliente ve como `null`.
 */
export interface SaleProductPriceRuleDto {
  uuid: string;
  name: string;
  /** `PriceRoundingMode` (`v74`). Ausente ⇒ dos decimales. */
  roundingMode?: string | null;
  /** `PriceRoundingDirection` (`v75`). Ausente ⇒ al más cercano. */
  roundingDirection?: string | null;
}

/** Una línea del carrito, ya con su precio resuelto. */
export interface SaleCartLine {
  product: SaleProductDto;
  quantity: number;
  /**
   * Precio unitario de la lista aplicada, o `null` cuando ninguna lista tiene precio para el
   * producto. El backend rechaza esa venta con 400, así que la pantalla la corta antes.
   */
  unitPrice: number | null;
  /** Lista que dio ese precio. Viaja en la línea del commit para congelarla como snapshot. */
  priceListUuid: string | null;
  /**
   * Lista que el operador fijó **para esta línea**. Lo normal es `null`: la resuelve el carrito con
   * la del cliente.
   *
   * Cuando está puesta manda sobre todo y resuelve **sin fallback**: si esa lista no tiene precio
   * para el producto, la línea queda sin precio a propósito. Caer a la principal cobraría un precio
   * de una lista distinta de la que se pidió, y en silencio.
   */
  chosenPriceListUuid: string | null;
  /** Impuesto del producto; el backend cae a 21 cuando el producto no lo declara. */
  taxRate: number;
  /**
   * Lote elegido a mano para esta línea, o `null` cuando lo decide la política de la sucursal.
   * Sólo tiene sentido en un producto con partidas; en los demás queda en `null`.
   */
  chosenBatch: SaleBatchChoice | null;
  /**
   * Las unidades que el cliente se lleva, por número de serie. Vacío en un producto que no las
   * lleva.
   *
   * Son **las** unidades, no una sugerencia: el backend saca exactamente éstas y de su lote, sin
   * pasar por la política de asignación de la sucursal. Tiene que haber tantas como
   * {@link quantity} (RN-17), y hasta que las haya la venta no se puede cobrar.
   */
  serials: readonly string[];
  /**
   * Empaque con el que se está cargando la línea, o `null` para unidades sueltas.
   *
   * **No cambia lo que se persiste** (RN-16): {@link quantity} sigue siendo la cantidad en unidad
   * base y es la que viaja al commit. El empaque sólo decide en qué unidad se *escribe* esa cantidad
   * —la fila pide cajas y muestra la equivalencia—, así que precio, stock, lote y comprobante no se
   * enteran de que existe.
   */
  packaging: PackagingRef | null;
}

/* ────────────────────────────  Promociones  ──────────────────────────── */

/**
 * Una promoción del catálogo de la empresa, tal como la lee el punto de venta.
 *
 * Es la misma fila que el ABM edita (`PromotionDTO`), recortada a lo que el motor evalúa y a lo que
 * el desglose muestra. El feature declara su propia forma —como ya hace con el cliente, el
 * comprobante y la lista de precios— en vez de importarla del feature de promociones: entre features
 * no hay dependencia, y el POS sólo lee.
 *
 * Las cinco colecciones son vínculos simples y **vacía significa «todas»**, no «ninguna»: sin
 * clientes aplica a cualquiera, sin sucursales en todas, sin medios de pago no mira los pagos.
 */
export interface SalePromotionDto {
  uuid: string;
  name: string;
  /**
   * `PromotionType` y `PromotionScope` como los manda el backend, y a propósito `string`: el enum lo
   * gobierna el Java. Un tipo que el front no conozca no descuenta nada de este lado —el motor no
   * sabe calcularlo— y el commit va a devolver un total distinto; es el riesgo que ADR-0002 acepta a
   * cambio de mostrar el descuento mientras se arma el carrito, y lo que los fixtures compartidos
   * vigilan.
   */
  type?: string | null;
  scope?: string | null;
  percent?: number | null;
  amount?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  /** Ausente es acumulable: es el default de la columna. */
  isCombinable?: boolean | null;
  isDiscontinued?: boolean | null;
  /** `YYYY-MM-DD`: un día completo, no un instante. */
  validFrom?: string | null;
  /** `YYYY-MM-DD`. Ausente ⇒ sin vencimiento. */
  validUntil?: string | null;
  products?: UuidNameRef[] | null;
  categories?: UuidNameRef[] | null;
  /** Audiencia: roles cliente. Es lo que la venta referencia en `orders.id_party_role`. */
  customers?: UuidNameRef[] | null;
  branches?: UuidNameRef[] | null;
  paymentMethods?: UuidNameRef[] | null;
  /** ISO 8601 con offset. Ordena el catálogo: la más antigua es la que desempata. */
  dateCreated?: string;
}

/**
 * La promoción en la forma exacta que evalúa el motor replicado.
 *
 * @param sequence La antigüedad, menor es más antigua. Del otro lado es el id de la fila, que acá no
 *   existe: la pantalla trae el catálogo ordenado por fecha de alta y la posición hace de id. Es el
 *   mismo compromiso que el índice de línea en un NxM — sin ids, el desempate se apoya en el orden.
 */
export function toPromotionCandidate(
  promotion: SalePromotionDto,
  sequence: number,
): PromotionCandidate {
  return {
    key: promotion.uuid,
    sequence,
    name: promotion.name,
    type: promotion.type as PromotionCandidate['type'],
    scope: promotion.scope as PromotionCandidate['scope'],
    percent: promotion.percent,
    amount: promotion.amount,
    buyQuantity: promotion.buyQuantity,
    payQuantity: promotion.payQuantity,
    combinable: promotion.isCombinable !== false,
    discontinued: promotion.isDiscontinued === true,
    validFrom: promotion.validFrom,
    validUntil: promotion.validUntil,
    productKeys: refUuids(promotion.products),
    categoryKeys: refUuids(promotion.categories),
    customerKeys: refUuids(promotion.customers),
    branchKeys: refUuids(promotion.branches),
    paymentMethodKeys: refUuids(promotion.paymentMethods),
  };
}

function refUuids(refs: readonly UuidNameRef[] | null | undefined): string[] {
  return (refs ?? []).map((ref) => ref.uuid).filter(Boolean);
}

/**
 * El detalle corto de una promoción, como **descriptor y no como texto**: los números salen acá y el
 * formato —el símbolo de moneda, el separador decimal— lo pone la plantilla con el locale activo.
 *
 * `UNKNOWN` cubre a la promoción que llega con el tipo o sus parámetros incompletos: el chip la
 * nombra igual, sin describirla. Inventarle un «−0%» diría un número que el comprobante no va a
 * confirmar.
 */
export type SalePromotionDetail =
  | { kind: 'PERCENTAGE'; percent: number }
  | { kind: 'FIXED_AMOUNT'; amount: number }
  | { kind: 'NXM'; buyQuantity: number; payQuantity: number }
  | { kind: 'UNKNOWN' };

export function salePromotionDetailOf(promotion: SalePromotionDto): SalePromotionDetail {
  if (promotion.type === 'PERCENTAGE' && promotion.percent != null) {
    return { kind: 'PERCENTAGE', percent: promotion.percent };
  }
  if (promotion.type === 'FIXED_AMOUNT' && promotion.amount != null) {
    return { kind: 'FIXED_AMOUNT', amount: promotion.amount };
  }
  if (promotion.type === 'NXM' && promotion.buyQuantity != null && promotion.payQuantity != null) {
    return { kind: 'NXM', buyQuantity: promotion.buyQuantity, payQuantity: promotion.payQuantity };
  }

  return { kind: 'UNKNOWN' };
}

/**
 * Una promoción aplicada sobre una línea: es el chip que la fila del carrito dibuja.
 *
 * {@link SaleLinePromotion.bonusQuantity} es lo que separa una **bonificación** de un **descuento**:
 * las unidades que un NxM dejó en $0 no son un porcentaje sobre un precio, y el glosario las nombra
 * distinto. El chip tiene que poder decirlo.
 */
export interface SaleLinePromotion {
  promotionKey: string;
  name: string;
  detail: SalePromotionDetail;
  /** Lo que esta promoción le restó a **esta** línea. */
  amount: number;
  /** Unidades que quedaron en $0 en esta línea. `0` fuera de un NxM. */
  bonusQuantity: number;
}

/**
 * Por qué una línea no se puede vender. Las dos frenan el commit, pero se resuelven distinto: una
 * eligiéndole otra lista a la línea, la otra cargando el precio que falta.
 */
export type LinePriceIssue = 'NO_PRICE' | 'ZERO_PRICE';

/** `Product.taxRate` por defecto en el backend. */
export const DEFAULT_TAX_RATE = 21;

/** Un componente de la línea con lo que hace falta para dibujarlo y para juzgar el faltante. */
export interface SaleCartKitComponent extends SaleKitComponent {
  /** Cuánto se lleva la línea entera: {@link SaleKitComponent.quantity} × cantidad del kit. */
  requiredQuantity: number;
  /** Cuánto le falta a ese componente para cubrirla; `0` si alcanza o si no lleva stock. */
  shortage: number;
}

/** Una línea con sus importes ya calculados, que es lo que la grilla dibuja. */
export interface SaleCartLineView extends SaleCartLine {
  /**
   * Los importes de la línea, **ya netos de promociones**: lo que las promociones restaron viaja en
   * `discountAmount` y el resto llega descontado, que es lo que se cobra.
   */
  amounts: LineAmounts | null;
  /**
   * Las promociones que alcanzaron a esta línea, una por chip. Vacío en la línea que ninguna tocó, y
   * también en la que sólo aportó unidades pagas a un NxM: ahí no hay nada que mostrar.
   */
  promotions: readonly SaleLinePromotion[];
  /** Cuánto falta de stock en la sucursal para cubrir la cantidad pedida; `0` si alcanza. */
  shortage: number;
  /**
   * El kit de la línea, o `null` en un producto común. Trae el disponible derivado y los componentes
   * ya expandidos a la cantidad de la línea, que es lo que la fila despliega **sin importe**: el
   * precio del combo está entero en la línea padre (RN-08).
   */
  kit: SaleKitInfo | null;
  kitComponents: readonly SaleCartKitComponent[];
  /** Por qué esta línea no se puede vender, o `null` cuando sí se puede. */
  priceIssue: LinePriceIssue | null;
  /** `true` si el producto lleva partidas: la fila muestra el lote y deja elegirlo con permiso. */
  batchTracked: boolean;
  /**
   * Cuánto le falta al lote elegido a mano para cubrir la cantidad; `0` si alcanza o si no hay lote
   * elegido. El backend rechaza la línea (`BATCH_NOT_AVAILABLE`), así que se frena acá.
   */
  batchShortage: number;
  /** `true` si el producto lleva series: la fila las muestra como chips y obliga a elegirlas. */
  serialTracked: boolean;
  /**
   * Cuántas series faltan elegir para cubrir la línea; `0` cuando están todas. Es lo que apaga el
   * botón de cobro, y con el nombre del producto es lo que se dice arriba en palabras.
   */
  serialShortage: number;
  /**
   * La cantidad expresada en el empaque elegido —2,5 cajas—, o `null` sin empaque. Es lo que la fila
   * pone en el input: la cantidad en unidad base queda a la vista al lado, en la equivalencia.
   */
  packageQuantity: number | null;
}

/**
 * @param rounding Criterio de la regla que alcanza al producto en la sucursal. Es **por línea**:
 *   desde `v74` el redondeo lo declara cada regla de precio, así que dos productos del mismo
 *   carrito pueden cerrar con criterios distintos.
 * @param addsTax Lo declara el comprobante elegido, y por eso es uno solo para todo el carrito.
 */
export function toCartLineView(
  line: SaleCartLine,
  rounding: PriceRounding,
  addsTax: boolean,
  kit: SaleKitInfo | null = null,
): SaleCartLineView {
  const kitComponents = toCartKitComponents(line, kit);

  return {
    ...line,
    amounts:
      line.unitPrice === null
        ? null
        : computeLineAmounts(line.unitPrice, line.quantity, line.taxRate, rounding, addsTax),
    // Los de lista: el descuento lo agrega el carrito, que es el único que ve la venta entera y
    // puede evaluarla. Una línea sola no alcanza — un NxM reparte unidades entre varias.
    promotions: [],
    shortage: shortageOf(line, kit),
    priceIssue: readPriceIssue(line.unitPrice),
    batchTracked: isBatchTracked(line.product),
    batchShortage: line.chosenBatch ? Math.max(0, line.quantity - line.chosenBatch.quantity) : 0,
    serialTracked: isSerialTracked(line.product),
    serialShortage: isSerialTracked(line.product)
      ? Math.max(0, line.quantity - line.serials.length)
      : 0,
    packageQuantity: packageQuantityOf(line.quantity, line.packaging),
    kit,
    kitComponents,
  };
}

/**
 * Cuánto falta para cubrir la línea. Son tres casos y no uno:
 *
 * - **Un kit virtual** se mide contra su disponible derivado (RN-07), no contra un saldo que no
 *   tiene. El **armado** no entra acá: tiene saldo propio y cae en el último caso, como cualquier
 *   mercadería (RN-22).
 *   Mientras el disponible no llegó —el detalle está en vuelo— no se anticipa nada: lo dirá el
 *   backend, que es quien valida componente por componente.
 * - **Un producto sin control de existencias** —un servicio— no tiene faltante posible: su
 *   `totalStock` es `null` porque no aplica, y tratarlo como cero inventaría un faltante en cada
 *   línea.
 * - **El resto**, contra el saldo de la sucursal, como siempre.
 */
function shortageOf(line: SaleCartLine, kit: SaleKitInfo | null): number {
  if (isVirtualKitProduct(line.product)) {
    return kit?.availability == null ? 0 : Math.max(0, line.quantity - kit.availability);
  }
  if (!tracksStock(line.product)) {
    return 0;
  }
  return Math.max(0, line.quantity - (line.product.totalStock ?? 0));
}

/** Los componentes expandidos a la cantidad de la línea, cada uno con su propio faltante. */
function toCartKitComponents(
  line: SaleCartLine,
  kit: SaleKitInfo | null,
): readonly SaleCartKitComponent[] {
  return (kit?.components ?? []).map((component) => {
    const requiredQuantity = component.quantity * line.quantity;
    return {
      ...component,
      requiredQuantity,
      shortage: component.limitsAvailability
        ? Math.max(0, requiredQuantity - (component.stock ?? 0))
        : 0,
    };
  });
}

/**
 * Un precio en cero **no** es un precio con el que vender: es una lista sin cargar, y regalar la
 * mercadería por un dato que falta es peor que frenar la venta. Se distingue de la ausencia total
 * porque la salida es otra: acá la lista existe y alguien tiene que ponerle el precio.
 */
function readPriceIssue(unitPrice: number | null): LinePriceIssue | null {
  if (unitPrice === null) {
    return 'NO_PRICE';
  }

  return unitPrice <= 0 ? 'ZERO_PRICE' : null;
}

/**
 * Precio de un producto con la misma prioridad que `PricingManagerService`: la lista elegida para la
 * línea, o la preferida del cliente.
 *
 * **Sin caída a la lista principal.** La había hasta la `v83`, gobernada por la configuración
 * `fallback_to_principal_price_list`; el backend la eliminó y ahora responde `400` en el checkout
 * cuando el producto no tiene precio en la lista del cliente. Simularla acá le mostraría al cajero
 * un precio con el que la venta no va a cerrar, que es la peor de las dos respuestas posibles.
 *
 * Devuelve `null` cuando la lista no tiene el producto: vender sin precio configurado es un `400`
 * del backend, no un precio cero.
 *
 * Un cero configurado sí lo devuelve —la entrada existe y dice eso—; que con ese precio no se pueda
 * vender lo decide {@link toCartLineView}, que es donde se juzga la línea entera.
 */
export function resolveUnitPrice(
  product: SaleProductDto,
  preferredPriceListUuid: string | null,
): { unitPrice: number; priceListUuid: string } | null {
  const entries = product.priceListEntries ?? [];

  const preferred = preferredPriceListUuid
    ? entries.find((entry) => entry.priceListUuid === preferredPriceListUuid)
    : undefined;

  return preferred?.price != null && preferred.price >= 0
    ? { unitPrice: preferred.price, priceListUuid: preferred.priceListUuid }
    : null;
}

/**
 * Un comprobante que descarga stock (`stockEffect === 'DECREMENT'`): es el que hace que la pantalla
 * tenga que anticipar el faltante. Con `NONE` —una orden de venta, un presupuesto— el backend no
 * mira el inventario, así que no hay nada que bloquear.
 */
export function decrementsStock(voucher: SaleVoucherDto | null): boolean {
  return voucher?.stockEffect === 'DECREMENT';
}

/**
 * Un comprobante de venta. Desde `v73` el sentido lo declara el propio comprobante y el commit lo
 * valida contra la contraparte: mandar uno de compra con un cliente responde 400, así que el
 * mostrador sólo ofrece estos.
 */
export function isSaleVoucher(voucher: SaleVoucherDto): boolean {
  return voucher.operationType === 'SALE';
}

/**
 * Si el comprobante suma el impuesto sobre el importe de la línea. Un comprobante que no lo declara
 * lo suma: es el default de la columna, y es como venía calculando el commit antes de `v73`.
 */
export function addsTax(voucher: SaleVoucherDto | null): boolean {
  return voucher?.addsTax !== false;
}

/**
 * Registrar la venta. El permiso lo elige el backend por el `operationType` del comprobante: un
 * comprobante de compra exigiría `purchase.create` aunque llegue por esta pantalla.
 */
export const SALE_CREATE_PERMISSION = Permissions.orderCreate;

/** Los catálogos que carga el punto de venta, por nombre: es lo que la pantalla dice cuando uno no carga. */
export type SaleCatalogName =
  | 'priceLists'
  | 'customers'
  | 'vouchers'
  | 'paymentMethods'
  | 'cashRegisters';

/**
 * Sin estos tres no hay venta que cerrar: el comprobante es obligatorio, se cobra con un medio de pago y
 * la operación es de una caja. Sin clientes se vende a consumidor final, y sin listas cotiza la principal.
 */
export const BLOCKING_SALE_CATALOGS: readonly SaleCatalogName[] = [
  'vouchers',
  'paymentMethods',
  'cashRegisters',
];

/**
 * Autorizar una venta que deja al cliente por encima de su límite de cuenta corriente.
 *
 * Es un permiso propio y no el de vender: dejar a alguien pasarse del tope es una decisión
 * comercial, y quien la toma no tiene por qué ser quien está atendiendo el mostrador.
 */
export const ACCOUNT_OVERRIDE_LIMIT_PERMISSION = Permissions.checkingAccountOverrideLimit;
