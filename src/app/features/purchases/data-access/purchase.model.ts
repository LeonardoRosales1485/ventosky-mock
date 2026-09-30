import { Permissions } from '../../../core/auth/permissions';
import { UuidNameRef } from '../../../core/http/api-refs';
import { OrderDto } from '../../../core/orders/order-commit.model';
import { LineAmounts, computeLineAmounts } from '../../../core/pricing/order-pricing';
import { PriceRounding } from '../../../core/pricing/price-rounding';
import { PackagingRef, packageQuantityOf } from '../../../core/product/product-lookup.model';

export type { UuidNameRef };

/**
 * Producto tal como lo ve la carga de compras: la fila de `POST /product/paginate`, ya acotada por
 * el backend a la sucursal activa.
 *
 * No trae un costo con el que prellenar la línea: el paginado **excluye a propósito** la lista
 * reservada `Costo` de `priceListEntries`, así que el costo se lee aparte, del detalle del producto
 * (`GET /product/uuid/{uuid}`).
 */
export interface PurchaseProductDto {
  uuid: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitMeasure?: string | null;
  /**
   * Decimales que admite la cantidad de la línea, derivados de la unidad del producto. `0` es el
   * producto que se compra de a enteros. Ver `core/product/quantity-precision.ts`.
   */
  unitDecimalPlaces?: number | null;
  taxRate?: number | null;
  /** El catálogo marca qué se puede comprar; el commit lo vuelve a validar y rechaza el resto. */
  isForPurchase?: boolean | null;
  /** Saldo actual en la sucursal. Es informativo: una compra suma, así que nunca bloquea. */
  totalStock?: number | null;
  /**
   * Naturaleza del producto (`SIMPLE` | `KIT` | `SERVICE`), tal como la devuelve el paginado. Acá
   * importa por una sola razón: **un kit no se compra**. Ver {@link isKitProduct}.
   */
  type?: string | null;
  /**
   * Eje de existencias (`NONE` | `QUANTITY` | `BATCH` | `SERIAL`). Con `BATCH` la línea tiene que
   * decir en qué partidas entra la mercadería antes de confirmar (§7.2).
   */
  stockTracking?: string | null;
  /** `NONE` | `OPTIONAL` | `REQUIRED`: si la partida lleva vencimiento y si es obligatorio. */
  expirationControl?: string | null;
  /**
   * Empaques declarados del producto, con los que la línea ofrece el selector. **No** vienen en el
   * paginado —`ProductPaginateDTO` no los trae—: los completa la resolución por código
   * (`GET /product/by-barcode`), que devuelve el `ProductDTO` entero. Un producto elegido del
   * buscador llega sin ellos y la línea no muestra selector, que es lo correcto: uno vacío diría
   * que el producto no tiene empaques cuando lo que pasa es que no se leyeron.
   */
  packagings?: readonly PurchasePackagingOption[] | null;
  /**
   * El modelo que agrupa a esta variante, o ausente en un producto suelto (RN-11). Es lo que deja
   * mostrar el modelo **una sola vez** en el buscador en vez de sus doce variantes (§5.6).
   */
  model?: UuidNameRef | null;
  /** Qué valor fija la variante en cada eje: «Talle: M». Vacío en un producto sin modelo. */
  variantValues?: PurchaseVariantValueDto[] | null;
}

/** Un valor que la variante fija en un eje, tal como lo devuelve el paginado. */
export interface PurchaseVariantValueDto {
  optionValueUuid?: string;
  optionUuid?: string;
  /** «Talle». */
  optionName?: string;
  /** «M». */
  value?: string;
  code?: string | null;
}

/**
 * Un modelo del catálogo (`POST /product-model/paginate`): lo que ofrece el desplegable de la carga
 * por modelo (§5.6, wireframe `1p`). `variantsCount` y `totalStock` son derivados de sólo lectura
 * —el modelo no cotiza ni tiene stock propio (RN-12)— y la matriz no viaja: las variantes se piden
 * al elegirlo, acotadas a la sucursal activa.
 */
export interface PurchaseModelDto {
  uuid: string;
  name: string;
  variantsCount?: number | null;
  totalStock?: number | null;
}

/** Si el producto lleva partidas: la compra le pide número de lote y, según el eje, vencimiento. */
/**
 * El empaque de una línea. Se re-exporta desde `core` —lo comparten la compra y el POS— para que el
 * feature siga teniendo un único lugar de donde importar sus tipos.
 */
export type { PackagingRef };

/** Un empaque ofrecido en la línea, tal como lo devuelve `GET /product/by-barcode`. */
export interface PurchasePackagingOption extends PackagingRef {
  isPurchaseDefault?: boolean | null;
}

export function isBatchTracked(
  product: Pick<PurchaseProductDto, 'stockTracking' | 'expirationControl'>,
): boolean {
  if (product.stockTracking === 'BATCH') {
    return true;
  }
  // `SERIAL` con vencimiento **también** lleva partidas: es el electrodoméstico con partida y serie
  // (P9). El vencimiento vive en la partida y no en el producto (RN-03), así que un serializado que
  // vence necesita una para llevarlo. Es la misma regla que `Product.usesNamedBatches()` en el
  // backend, y tiene que decir lo mismo: si acá dijera que no, la línea no mandaría `batches[]` y
  // el commit la rechazaría.
  // `expirationControl` ausente es `NONE`, igual que en el backend: sin este default, un producto
  // serializado sin control de vencimiento pediría partidas que la pantalla no dibuja y la línea
  // quedaría trabada para siempre.
  return (
    product.stockTracking === 'SERIAL' &&
    product.expirationControl != null &&
    product.expirationControl !== 'NONE'
  );
}

/** Si el producto lleva números de serie: una unidad física por cada uno (§9). */
export function isSerialTracked(product: Pick<PurchaseProductDto, 'stockTracking'>): boolean {
  return product.stockTracking === 'SERIAL';
}

/**
 * Un kit, en cualquiera de sus dos modos. Acá la pregunta es una sola porque **ninguno se compra**
 * (`KIT_NOT_PURCHASABLE`): es un conjunto que arma la empresa con productos suyos, así que al
 * proveedor se le compran las partes.
 *
 * El **virtual** no existe en ningún estante (§6.1) —su disponible sale de los componentes— y el
 * **armado**, que sí tiene saldo propio, lo produce el documento de armado consumiendo los
 * componentes (§6.6): comprarlo hecho sumaría existencias sin descontar ninguna. Por eso no hace
 * falta `kitMode`, que además el paginado no trae.
 */
export function isKitProduct(product: Pick<PurchaseProductDto, 'type'>): boolean {
  return product.type === 'KIT';
}

/** Si el producto exige vencimiento al ingresar (RN-03). */
export function requiresExpiration(product: Pick<PurchaseProductDto, 'expirationControl'>): boolean {
  return product.expirationControl === 'REQUIRED';
}

/** Si el producto admite vencimiento en la partida (obligatorio u opcional). */
export function acceptsExpiration(product: Pick<PurchaseProductDto, 'expirationControl'>): boolean {
  return product.expirationControl === 'REQUIRED' || product.expirationControl === 'OPTIONAL';
}

/**
 * Una partida de una línea de compra: cómo llega en el remito del proveedor (dos lotes en un
 * renglón). Viaja en `items[].batches` del commit; el backend abre la partida si no existe y
 * acumula si ya está, por número y vencimiento.
 */
export interface PurchaseBatchSplit {
  /** Clave local de la fila, para que la grilla no pierda el foco al editar. */
  key: string;
  batchNumber: string;
  /** `yyyy-MM-dd`, o `null` sin vencimiento. */
  expirationDate: string | null;
  quantity: number | null;
}

/** Detalle del producto, del que la compra sólo usa el costo (`GET /product/uuid/{uuid}`). */
export interface PurchaseProductDetailDto {
  uuid: string;
  /**
   * Costo unitario persistido para la sucursal activa, calculado con el método de costeo de la
   * sucursal (`FIFO`, `LIFO` o `AVERAGE`). Es `0` —nunca `null`— mientras no haya entrado stock con
   * costo.
   */
  cost?: number | null;
  costMethod?: string | null;
  /**
   * Empaques del producto. Vienen en el **detalle** y no en el paginado, así que una línea cargada
   * desde el buscador de texto los recibe por esta lectura —la misma que ya traía el costo—, no por
   * la fila que la creó.
   */
  packagings?: readonly PurchasePackagingOption[] | null;
}

/** Proveedor del select (`POST /party/supplier/paginate`): el rol `SUPPLIER` del maestro unificado. */
export interface PurchaseSupplierDto {
  uuid: string;
  name: string;
  docType?: string | null;
  docNumber?: string | null;
}

/** Medio de pago habilitado (`POST /payment-method/paginate`). */
export interface PurchasePaymentMethodDto {
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
 * misma fila: el backend fusionó `voucher_type` dentro de `voucher`.
 */
export interface PurchaseVoucherDto {
  uuid: string;
  /** Identificador dentro de la empresa (`PURCHASE_INVOICE_A`, `PURCHASE_DELIVERY_NOTE`…). */
  code?: string | null;
  name: string;
  /**
   * `PURCHASE` o `SALE`: qué operación cierra el comprobante. Es lo único que la distingue —la orden
   * no tiene campo `type`— y el commit exige la contraparte que le corresponde.
   */
  operationType?: VoucherOperation | string | null;
  /** En compra lo natural es `INCREMENT`: la mercadería entra. */
  stockEffect?: VoucherEffect | string | null;
  /** En compra lo natural es `DECREMENT`: es un egreso para la empresa. */
  balanceEffect?: VoucherEffect | string | null;
  /** Informativo: hoy la numeración sale de `last_public_id` de la sucursal en todos los casos. */
  isFiscal?: boolean | null;
  /**
   * Si el impuesto se suma al importe de la línea. `true` (default del backend) discrimina el IVA y
   * lo agrega al neto —una factura A—; `false` toma el costo tal cual, que es lo que corresponde a
   * una factura B o C.
   */
  addsTax?: boolean | null;
}

/**
 * La regla de precio efectiva de un producto (`GET /price-rule/product/{uuid}`), de la que a esta
 * pantalla sólo le interesa el criterio de redondeo: es con el que el backend va a redondear el
 * costo declarado. Sin regla el backend responde `204`, que el cliente ve como `null`.
 */
export interface PurchaseProductPriceRuleDto {
  uuid: string;
  name: string;
  /** `PriceRoundingMode` (`v74`). Ausente ⇒ dos decimales. */
  roundingMode?: string | null;
  /** `PriceRoundingDirection` (`v75`). Ausente ⇒ al más cercano. */
  roundingDirection?: string | null;
}

/**
 * Una línea de la compra.
 *
 * A diferencia de la venta no hay lista de precios que resolver —el backend fuerza
 * `order_items.id_price_list` a `NULL` cuando la contraparte es un proveedor—: el importe unitario
 * es el **costo**, y lo escribe el operador.
 */
export interface PurchaseCartLine {
  product: PurchaseProductDto;
  quantity: number;
  /**
   * Costo por unidad. `null` es "todavía no se cargó" y frena el commit; `0` es un costo válido —el
   * backend sólo rechaza `null` y los negativos—, por ejemplo una bonificación del proveedor.
   */
  unitCost: number | null;
  /** Impuesto del producto; el backend cae a 21 cuando el producto no lo declara. */
  taxRate: number;
  /**
   * El reparto en partidas de un producto `BATCH`. Vacío en los demás, donde no viaja. La suma de
   * las cantidades tiene que dar la de la línea: el backend rechaza el reparto que no cuadra.
   */
  batches: readonly PurchaseBatchSplit[];
  /**
   * Los números de serie de un producto `SERIAL`, uno por unidad. Vacío en los demás, donde no
   * viaja.
   *
   * La cantidad de la línea **es** la cantidad de series (RN-17): no son dos números que hay que
   * mantener iguales, es el mismo número escrito de dos maneras. Por eso cargar una serie sube la
   * cantidad y borrarla la baja.
   */
  serials: readonly string[];
  /**
   * Empaque con el que se está cargando la línea, o `null` para unidades sueltas. Es **el** caso de
   * la ferretería: se compra por bulto y se vende por unidad.
   *
   * **No cambia lo que se persiste** (RN-16): {@link quantity} sigue siendo la cantidad en unidad
   * base y es la que viaja al commit, la que tiene que cuadrar con el reparto en partidas y la que
   * entra al kardex. El empaque sólo decide en qué unidad se *escribe* ese número.
   */
  packaging: PackagingRef | null;
  /**
   * `true` cuando la cantidad la fijó quien agregó la línea —la lectura de un bulto o de una
   * etiqueta de balanza, una celda de la grilla por modelo— y no es el «1 neutro» de elegir un
   * producto de la lista. El empaque por defecto que llega después con el detalle no la
   * reinterpreta: seis remeras son seis remeras, no seis bultos.
   */
  explicitQuantity?: boolean;
}

/** `Product.taxRate` por defecto en el backend. */
export const DEFAULT_TAX_RATE = 21;

/** Una línea con sus importes ya calculados, que es lo que la grilla dibuja. */
export interface PurchaseCartLineView extends PurchaseCartLine {
  amounts: LineAmounts | null;
  /** `true` mientras la línea no tenga un costo con el que cerrar la compra. */
  missingCost: boolean;
  /** `true` si el producto lleva partidas y la línea las tiene que repartir. */
  requiresBatches: boolean;
  /** Cuánto de la línea ya está repartido en partidas. */
  allocatedQuantity: number;
  /**
   * Por qué el reparto todavía no cierra, o `null` cuando está completo (o no aplica). Es lo que
   * traba el commit, dicho por línea para no adivinar cuál es.
   */
  batchIssue: PurchaseBatchIssue | null;
  /** `true` si el producto lleva números de serie y la línea los tiene que informar. */
  requiresSerials: boolean;
  /**
   * Por qué las series todavía no cierran, o `null` cuando están completas (o no aplica). Es lo que
   * traba el commit, dicho por línea.
   */
  serialIssue: PurchaseSerialIssue | null;
  /**
   * La cantidad expresada en el empaque elegido —2 bultos—, o `null` sin empaque. Es lo que la fila
   * pone en el input; la cantidad en unidad base queda a la vista en la equivalencia.
   */
  packageQuantity: number | null;
}

/**
 * Qué le falta a las series de una línea: no son tantas como unidades (RN-17), o hay un número
 * repetido.
 *
 * `DUPLICATED` es su propio caso y no un `COUNT_MISMATCH` porque el número **está**: lo que no
 * puede es entrar dos veces. Es el error del pegado masivo y de escanear dos veces la misma
 * etiqueta, y decir «faltan series» mandaría a buscar el problema al lugar equivocado.
 */
export type PurchaseSerialIssue = 'COUNT_MISMATCH' | 'DUPLICATED';

/**
 * Qué le falta al reparto de una línea: no suma la cantidad, una partida sin número, o una sin
 * vencimiento cuando el producto lo exige (RN-03).
 */
export type PurchaseBatchIssue = 'UNBALANCED' | 'MISSING_NUMBER' | 'MISSING_EXPIRATION';

/** Tolerancia con la que se compara lo repartido con la cantidad: cantidades ya redondeadas. */
const QUANTITY_EPSILON = 1e-6;

/** Lo que las partidas ya cubren de la línea. */
export function allocatedQuantity(batches: readonly PurchaseBatchSplit[]): number {
  return batches.reduce((total, batch) => total + (batch.quantity ?? 0), 0);
}

/** Qué le falta al reparto, o `null` si cierra. Una línea sin partidas no cierra: hay que abrirlas. */
export function readBatchIssue(
  line: Pick<PurchaseCartLine, 'product' | 'quantity' | 'batches'>,
): PurchaseBatchIssue | null {
  if (!isBatchTracked(line.product)) {
    return null;
  }

  if (line.batches.some((batch) => !batch.batchNumber.trim())) {
    return 'MISSING_NUMBER';
  }

  if (requiresExpiration(line.product) && line.batches.some((batch) => !batch.expirationDate)) {
    return 'MISSING_EXPIRATION';
  }

  return Math.abs(allocatedQuantity(line.batches) - line.quantity) <= QUANTITY_EPSILON &&
    line.batches.length > 0
    ? null
    : 'UNBALANCED';
}

/** Qué les falta a las series, o `null` si cierran. */
export function readSerialIssue(
  line: Pick<PurchaseCartLine, 'product' | 'quantity' | 'serials'>,
): PurchaseSerialIssue | null {
  if (!isSerialTracked(line.product)) {
    return null;
  }

  const normalized = line.serials.map((serial) => serial.trim().toUpperCase());
  if (new Set(normalized).size !== normalized.length) {
    return 'DUPLICATED';
  }

  return line.serials.length === line.quantity ? null : 'COUNT_MISMATCH';
}

/**
 * @param rounding Criterio de la regla que alcanza al producto en la sucursal. Es **por línea**:
 *   desde `v74` el redondeo lo declara cada regla de precio, así que dos productos de la misma
 *   compra pueden cerrar con criterios distintos.
 * @param addsTax Lo declara el comprobante elegido, y por eso es uno solo para toda la compra.
 */
export function toPurchaseCartLineView(
  line: PurchaseCartLine,
  rounding: PriceRounding,
  addsTax: boolean,
): PurchaseCartLineView {
  return {
    ...line,
    amounts:
      line.unitCost === null
        ? null
        : computeLineAmounts(line.unitCost, line.quantity, line.taxRate, rounding, addsTax),
    missingCost: line.unitCost === null,
    requiresBatches: isBatchTracked(line.product),
    allocatedQuantity: allocatedQuantity(line.batches),
    batchIssue: readBatchIssue(line),
    requiresSerials: isSerialTracked(line.product),
    serialIssue: readSerialIssue(line),
    packageQuantity: packageQuantityOf(line.quantity, line.packaging),
  };
}

/**
 * Un comprobante de compra. El commit valida el sentido contra la contraparte: mandar uno de venta
 * con un proveedor responde 400, así que la pantalla sólo ofrece estos.
 */
export function isPurchaseVoucher(voucher: PurchaseVoucherDto): boolean {
  return voucher.operationType === 'PURCHASE';
}

/**
 * Si el comprobante suma el impuesto sobre el importe de la línea. Un comprobante que no lo declara
 * lo suma: es el default de la columna en el backend.
 */
export function addsTax(voucher: PurchaseVoucherDto | null): boolean {
  return voucher?.addsTax !== false;
}

/**
 * Si la operación se paga en el momento.
 *
 * Un comprobante de compra que no toca el balance —una orden de compra, un presupuesto, un remito—
 * no representa un egreso: el backend **no** crea checkout ni pagos, y si el commit igual los trae
 * responde 400 (`PaymentsNotAllowedException`). Así que ahí los pagos no es que sean opcionales:
 * no van.
 *
 * Un comprobante que no declara el efecto sí pide pago, que es como lo lee el backend
 * (`OrderCommitService.isCheckoutRequired` sólo exime al `NONE` explícito).
 */
export function requiresPayment(voucher: PurchaseVoucherDto | null): boolean {
  return voucher === null || voucher.balanceEffect !== 'NONE';
}

/**
 * Si un comprobante no mueve nada: ni el inventario ni la cuenta corriente. Toma los efectos
 * sueltos porque llegan de dos formas distintas —el catálogo (`PurchaseVoucherDto`) y el
 * comprobante ya congelado en la orden (`OrderVoucherDto`)— y la pregunta es la misma.
 */
function hasNoEffects(
  stockEffect: string | null | undefined,
  balanceEffect: string | null | undefined,
): boolean {
  return stockEffect === 'NONE' && balanceEffect === 'NONE';
}

/**
 * Si el comprobante documenta una **orden de compra**: no toca el stock ni la cuenta corriente, así
 * que lo que se registra es un pedido al proveedor y no una compra hecha.
 *
 * Es la única orden que el backend deja editar después: `POST /order/{uuid}/convert` la reemplaza
 * por el comprobante definitivo y recién ahí aplica stock, costo y saldo.
 */
export function isDraftOrderVoucher(voucher: PurchaseVoucherDto | null): boolean {
  return hasNoEffects(voucher?.stockEffect, voucher?.balanceEffect);
}

/**
 * Si esta compra se puede editar. Es la misma pregunta que se hace `OrderConversionService`
 * —`assertConvertible`— antes de aceptar la conversión, hecha del lado del front para no ofrecer un
 * botón que responde 409.
 *
 * Una compra **no** se edita en general: el backend no tiene `PUT` de orden y `/order/save` responde
 * 410. Lo único editable es la orden de compra borrador, y deja de serlo en cuanto se convierte —a
 * partir de ahí movió stock y saldo, y deshacer eso sería otra operación, no una edición—.
 *
 * Se exige la contraparte porque una compra sin proveedor no existe: el backend la valida contra el
 * `operationType` del comprobante, que es también de donde sale el permiso.
 */
export function isEditablePurchase(order: OrderDto): boolean {
  return (
    !!order.partyRole?.uuid &&
    hasNoEffects(order.voucher?.stockEffect, order.voucher?.balanceEffect)
  );
}

/**
 * Registrar la compra. `POST /order/commit` exige `purchase.create` —y no `order.create`— en cuanto
 * el comprobante enviado declara `operationType = PURCHASE`: es el mismo endpoint, y el permiso es
 * lo único que distingue una compra de una venta a efectos de RBAC. Antes salía de mirar si el body
 * traía proveedor, que con la venta sin tercero dejó de ser una pista fiable.
 */
export const PURCHASE_CREATE_PERMISSION = Permissions.purchaseCreate;

/** Los catálogos que carga la compra, por nombre: es lo que la pantalla dice cuando uno no carga. */
export type PurchaseCatalogName = 'suppliers' | 'vouchers' | 'paymentMethods' | 'cashRegisters';

/**
 * Sin estos cuatro no hay compra que registrar: la contraparte y el comprobante son obligatorios, se
 * paga con un medio de pago y la operación es de una caja.
 */
export const BLOCKING_PURCHASE_CATALOGS: readonly PurchaseCatalogName[] = [
  'suppliers',
  'vouchers',
  'paymentMethods',
  'cashRegisters',
];

/**
 * Editar una compra. Vale lo mismo que arriba: `POST /order/{uuid}/convert` exige `purchase.edit`
 * —y no `order.edit`— porque el body lleva un proveedor, y es el propio controller el que elige el
 * permiso mirándolo.
 */
export const PURCHASE_EDIT_PERMISSION = Permissions.purchaseEdit;
