import { HttpErrorResponse } from '@angular/common/http';
import { readApiErrorData } from '../http/api-error.model';
import { UuidNameRef } from '../http/api-refs';

/**
 * El contrato de `POST /order/commit`, que es **uno solo para compra y venta**: el backend unificó
 * las dos operaciones en la misma tabla, el mismo endpoint y el mismo service, y lo que las
 * distingue es el comprobante enviado. La contraparte es **una sola** —`partyRole`—, desde que el
 * maestro de terceros unificó clientes y proveedores. Por eso vive en `core/` y no dentro de un
 * feature: duplicarlo llevaría a que una de las dos pantallas se quedara atrás cuando el contrato
 * cambie.
 */

/**
 * Lo que entra en `orders.observations`. El backend valida el mismo límite y responde 400
 * (`ORDER_OBSERVATIONS_TOO_LONG`) si se pasa, así que la pantalla corta antes de mandar.
 */
export const ORDER_OBSERVATIONS_MAX_LENGTH = 1000;

/**
 * Una línea del commit.
 *
 * El `unitPrice` es lo que separa las dos operaciones: en **compra** es el costo que declara el
 * operador y es obligatorio; en **venta** se ignora, porque el precio lo resuelve la lista.
 */
export interface OrderCommitItem {
  product: { uuid: string };
  quantity: number;
  /** Sólo compra: el costo por unidad. El backend rechaza `null` o negativo; `0` es válido. */
  unitPrice?: number;
  /** Sólo venta: sobrescribe la lista preferida del cliente para esta línea, como snapshot. */
  priceList?: { uuid: string };
  /**
   * Reparto por lote de la línea, sólo para productos con partidas (`stock_tracking = BATCH`).
   * En compra es obligatorio y dice en qué partidas entra la mercadería; en venta es opcional y
   * nombra el lote elegido a mano (permiso `stock.batch_select`). La suma tiene que dar `quantity`.
   */
  batches?: OrderCommitItemBatch[];
}

/**
 * Una partida de una línea (`OrderItemBatchDTO`). Compra: `batchNumber` + `expirationDate`
 * (`yyyy-MM-dd`, obligatoria con `expiration_control = REQUIRED`). Venta: `batchUuid` del lote
 * elegido. En los dos casos `quantity` es lo que entra en (o sale de) ese lote.
 */
export interface OrderCommitItemBatch {
  batchUuid?: string;
  batchNumber?: string;
  expirationDate?: string;
  quantity: number;
}

/**
 * Tipos de documento que puede llevar el receptor de un comprobante (`ReceiverDocumentTypes`).
 *
 * Son los del maestro de terceros más `SIN_IDENTIFICAR`, y esa diferencia es el punto: un tercero
 * sin documento simplemente no lo tiene cargado, mientras que en un comprobante «no se identificó
 * al comprador» es una afirmación explícita sobre lo que se imprimió.
 */
export const RECEIVER_DOCUMENT_TYPES = ['CUIT', 'CUIL', 'DNI', 'SIN_IDENTIFICAR'] as const;

export type ReceiverDocumentType = (typeof RECEIVER_DOCUMENT_TYPES)[number];

/**
 * El receptor del comprobante, tal como se va a imprimir.
 *
 * **No es el tercero.** El backend lo congela en la orden al emitir (`orders.receiver_*`) y el PDF
 * lo lee de ahí, así que editarle después la ficha al cliente no cambia un comprobante ya emitido.
 * Antes se resolvía leyendo el `party` en vivo y una corrección de razón social reescribía el
 * pasado.
 *
 * **El bloque es todo o nada.** Si el commit manda algún campo, el receptor es ése y el tercero no
 * aporta nada; si no manda ninguno, el backend copia los cuatro de la ficha del `partyRole`; si no
 * hay ni una cosa ni la otra, el comprobante sale a consumidor final. Por eso esta pantalla precarga
 * la ficha y manda el bloque completo: mezclar campo a campo produciría un receptor que nunca
 * existió —facturar a otro CUIT heredando la condición de IVA del cliente del mostrador.
 */
export interface OrderReceiver {
  receiverName?: string;
  receiverDocType?: ReceiverDocumentType | string;
  receiverDocNumber?: string;
  receiverTaxCondition?: string;
}

export interface OrderCommitPayment {
  paymentMethod: { uuid: string };
  /** Con un solo pago puede omitirse y el backend usa el total del checkout. */
  amount?: number;
}

/** Lo que comparten compra y venta; la contraparte la agrega {@link OrderCommitPayload}. */
interface OrderCommitBase extends OrderReceiver {
  /** `uuid` de la fila del catálogo de comprobantes: de ahí salen los efectos y la fiscalidad. */
  voucher: { uuid: string };
  /** Opcional si viaja el header `X-Cash-Register-Uuid`, que esta app no envía. */
  cashRegister: { uuid: string };
  /**
   * Ancla con la que el backend resuelve la sesión de caja (`LocalDateTime`, sin zona). Sin ella
   * usa el instante del commit.
   */
  dateOperation?: string;
  items: OrderCommitItem[];
  orderCheckout: { payments: OrderCommitPayment[] };
  /**
   * Nota libre sobre la operación, opcional y de hasta 1000 caracteres. No entra en ningún
   * cálculo: documenta lo que el comprobante no dice. En blanco equivale a no mandarla, y pasada
   * de largo el backend responde 400 (`ORDER_OBSERVATIONS_TOO_LONG`).
   */
  observations?: string;
  /** `true` tras un 409 por faltante, cuando el operador confirma operar igual. */
  confirmStockOverride?: boolean;
  /** `true` para cerrar pese a un fallo de integración; ese pago queda en `FORCED`. */
  confirmPaymentOverride?: boolean;
  /**
   * `true` tras un 400 `BATCH_EXPIRED` confirmable: la sucursal está en `WARN` y el operador
   * acepta despachar de un lote vencido. Con `BLOCK` no hay confirmación posible.
   */
  confirmExpiredOverride?: boolean;
  /**
   * `true` tras un rechazo por límite de cuenta corriente, cuando alguien con
   * `checking_account.override_limit` autoriza dejar al titular por encima de su tope.
   *
   * Mismo patrón que {@link confirmStockOverride} con una diferencia: **exige un motivo**. Sin
   * {@link accountOverrideReason} el backend responde 400 aunque el permiso esté — una deuda por
   * encima del límite sin nada que la explique es exactamente el registro que la excepción existe
   * para evitar.
   */
  confirmAccountOverride?: boolean;
  /**
   * Por qué se autorizó. Obligatorio junto con {@link confirmAccountOverride}, y queda estampado en
   * la deuda con quién lo autorizó y cuánto se pasó del límite.
   */
  accountOverrideReason?: string;
}

/**
 * Body de `POST /order/commit`.
 *
 * La contraparte es **una sola columna**, y su rol tiene que coincidir con el `operationType` del
 * comprobante: una compra exige un rol `SUPPLIER` y una venta con tercero exige `CUSTOMER`. Cruzada,
 * el backend responde 400.
 *
 * **Omitirla es válido sólo en la venta**: es la de mostrador a consumidor final, que desde la
 * unificación va sin tercero y sin fila sentinela que lo simule. La compra siempre lo exige — su
 * factura está en la mano.
 */
export type OrderCommitPayload = OrderCommitBase & {
  partyRole?: { uuid: string };
};

/**
 * Body de `POST /order/{uuid}/convert`: la única escritura que el backend acepta sobre una orden ya
 * existente. Reemplaza comprobante, líneas y checkout de una **orden de compra borrador** —la que se
 * cerró contra un comprobante sin efectos— y recién ahí aplica stock, costo/precio y cuenta
 * corriente.
 *
 * Tres diferencias con el commit que no son de forma:
 *
 * - **`partyRole` es opcional y se envía igual.** El permiso ya no se deduce del body: sale del
 *   `operationType` del comprobante, así que omitirlo no cambia el 403. Se manda porque el resolver
 *   valida que sea el mismo de la orden, y mandarlo deja explícito que la conversión no cambia de
 *   proveedor.
 * - **`version` es obligatoria**: es el bloqueo optimista del ABM, y desactualizada responde 409.
 * - **Lo que no viaja no se decide.** La conversión pisa la orden con lo que llega: un `expiresAt`
 *   omitido queda en `null`, mientras que una `observations` omitida **conserva** la nota anterior
 *   —`applyObservations` ignora el campo ausente— y una cadena vacía la borra. Los dos casos piden
 *   lo mismo: reenviar lo que la pantalla tiene, en vez de omitir lo que parece redundante.
 *
 * `company`, `branch` y `publicId` no se pueden cambiar y por eso no están acá; `cashRegister` y
 * `dateOperation` sí, y omitidos se quedan con los de la orden.
 */
export interface OrderConvertPayload {
  version: number;
  /** El comprobante definitivo. Si tampoco tiene efectos, la orden sigue siendo un borrador. */
  voucher: { uuid: string };
  /** El proveedor de la orden. El backend rechaza uno distinto: la conversión no lo cambia. */
  partyRole?: { uuid: string };
  items: OrderCommitItem[];
  orderCheckout: { payments: OrderCommitPayment[] };
  cashRegister?: { uuid: string };
  dateOperation?: string;
  expiresAt?: string;
  /**
   * Obligatoria, a diferencia del commit: acá omitirla no significa «sin nota» sino «no la toques»,
   * así que borrar la del formulario no llegaría nunca. La cadena vacía es la que la borra.
   */
  observations: string;
  confirmPaymentOverride?: boolean;
}

/**
 * La contraparte tal como la devuelve el backend: el rol del tercero, con su identidad al lado.
 * Reemplaza a las dos referencias `customer` / `supplier` que la orden traía antes.
 */
export interface OrderPartyRoleDto {
  uuid: string;
  name?: string | null;
  docType?: string | null;
  docNumber?: string | null;
  /** `CUSTOMER` en una venta, `SUPPLIER` en una compra. */
  role?: string | null;
}

export interface OrderPaymentDto {
  uuid?: string;
  paymentMethod?: UuidNameRef | null;
  amount?: number | null;
  /** `AUTHORIZED`, o `FORCED` cuando se cerró con `confirmPaymentOverride`. */
  state?: string | null;
}

export interface OrderCheckoutDto {
  /** Quién cerró la operación: el vendedor en venta, quien recepcionó en compra. */
  seller?: UuidNameRef | null;
  payments?: OrderPaymentDto[] | null;
  totalAmount?: number | null;
  taxAmount?: number | null;
  discountAmount?: number | null;
}

/**
 * El comprobante que devuelve el commit: la fila del catálogo a la que apuntó la orden, ya sin el
 * `voucherType` anidado que existía antes de la fusión. No lleva número propio — el `publicId` vive
 * sólo en la orden.
 */
export interface OrderVoucherDto {
  uuid?: string;
  code?: string | null;
  name?: string | null;
  stockEffect?: string | null;
  balanceEffect?: string | null;
  isFiscal?: boolean | null;
}

/**
 * Una línea tal como la devuelve el backend. El `product` viene reducido a `uuid` + `name`: lo que
 * la línea sabe de él es lo que se congeló al cerrarla, no su ficha —de ahí que la precisión de la
 * cantidad o el stock actual haya que ir a buscarlos al catálogo si la pantalla los necesita.
 */
export interface OrderItemDto {
  uuid?: string;
  product?: UuidNameRef | null;
  /**
   * En qué estado del catálogo quedó ese producto, desde el backend `6.9.0`: `DISCONTINUED`,
   * `ARCHIVED` o **ausente** si sigue en circulación (ver `product-catalog-state.ts`).
   *
   * Sólo lectura: lo deriva el backend del producto que de todos modos ya cargó para resolver el
   * nombre de la línea. Va suelto y no dentro de {@link product} porque `UuidNameRef` es el tipo de
   * referencia genérico de todo el sistema.
   */
  productState?: string | null;
  quantity?: number | null;
  /** El costo por unidad en compra; en venta, el precio ya resuelto por la lista. */
  unitPrice?: number | null;
  taxRate?: number | null;
  taxAmount?: number | null;
  discountAmount?: number | null;
  subtotal?: number | null;
  /**
   * De qué lote y depósito salió (o a cuál entró) cada porción de la línea. Lo resuelve el backend
   * al aplicar el efecto de stock: es la trazabilidad de la venta al lote (§7.5).
   */
  stockItems?: OrderStockItemDto[] | null;
}

/**
 * Una promoción aplicada en una venta registrada, tal como quedó **congelada** al cobrar
 * (`OrderPromotionDTO`, desde el backend `6.11.0`).
 *
 * **Es un snapshot, no una referencia.** El nombre, el tipo y el detalle son los que la promoción
 * tenía ese día: editarla, discontinuarla o archivarla después no reescribe lo que dice una venta
 * vieja. Por eso {@link promotion} trae el `uuid` de la promoción viva —para poder agrupar cuánto
 * otorgó cada una— pero su `name` es el del snapshot.
 *
 * **Sólo lectura.** El commit no acepta promociones del front: las calcula y persiste el backend, y
 * el front replica el motor únicamente para anticipar el descuento en el carrito (ADR 0002).
 */
export interface OrderPromotionDto {
  uuid?: string;
  /** La promoción de origen, con el **nombre del snapshot** en lugar del actual. */
  promotion?: UuidNameRef | null;
  /**
   * La línea alcanzada, o nulo si el descuento fue sobre el total de la venta. Cuando tiene valor
   * referencia **siempre una línea padre**: el motor no mira la composición de un kit (ADR 0003).
   */
  orderItemUuid?: string | null;
  /** `PERCENTAGE` | `FIXED_AMOUNT` | `NXM`, congelado. */
  promotionType?: string | null;
  /** El detalle corto ya escrito por el backend: `3x2`, `-10%`, `-$500`. Congelado. */
  promotionDetail?: string | null;
  /** Unidades que un NxM dejó en $0 sobre esa línea. Cero en los otros tipos. */
  bonusQuantity?: number | null;
  /** Importe descontado por esta promoción. */
  amount?: number | null;
}

/** Una porción de una línea sobre un lote (`StockItemDTO`). Sólo lectura. */
export interface OrderStockItemDto {
  uuid?: string;
  warehouse?: UuidNameRef | null;
  /** Enlaza con la trazabilidad del lote (`/panel/stock/batch/:uuid`). */
  batchUuid?: string | null;
  batchNumber?: string | null;
  /** `yyyy-MM-dd`, o nulo en un lote sin vencimiento. */
  expirationDate?: string | null;
  quantity?: number | null;
}

/**
 * Una orden tal como la devuelve el backend, reducida a lo que las pantallas informan.
 *
 * Es la misma forma en las tres lecturas que hoy usa el front: la respuesta de `POST /order/commit`,
 * cada fila de `POST /order/paginate` y el detalle de `GET /order/uuid/{uuid}` — el backend mapea el
 * mismo `OrderDTO` para las tres. Lo que cambia es cuánto viene poblado: `items` sólo llega con
 * contenido en el detalle.
 */
export interface OrderDto {
  uuid: string;
  /**
   * Versión de la fila, para el bloqueo optimista. Sólo la necesita quien va a **escribir** sobre
   * una orden existente, que hoy es únicamente la conversión (`POST /order/{uuid}/convert`).
   */
  version?: number;
  /**
   * Número de la operación. Sale del contador `last_public_id` de la sucursal y hoy se asigna
   * también a los comprobantes fiscales, mientras no exista integración con el circuito fiscal.
   */
  publicId?: string | null;
  voucher?: OrderVoucherDto | null;
  /**
   * Contraparte de la operación, una sola. Trae el rol —`CUSTOMER` o `SUPPLIER`— porque quien la lee
   * necesita saber de qué lado está sin volver a preguntar. Nula en la venta sin tercero.
   */
  partyRole?: OrderPartyRoleDto | null;
  /**
   * Sucursal en la que se registró la operación. El commit la toma del header `X-Branch-Uuid`, pero
   * el paginado **no** se acota a ella —el backend sólo filtra por empresa—, así que un listado que
   * abarca varias sucursales necesita nombrarla.
   */
  branch?: UuidNameRef | null;
  cashRegister?: UuidNameRef | null;
  dateOperation?: string | null;
  /** Vencimiento del comprobante, cuando lleva uno. Sólo lo usan orden y presupuesto de compra. */
  expiresAt?: string | null;
  /** La nota con la que se cerró la operación, ya recortada por el backend. */
  observations?: string | null;
  /**
   * El receptor **congelado** al emitir. Es lo que dice el comprobante, y no tiene por qué coincidir
   * con la ficha actual de `partyRole`: si al tercero le corrigieron la razón social después, acá
   * sigue estando la de aquel día. Nulos en la venta de mostrador sin nada tipeado.
   */
  receiverName?: string | null;
  receiverDocType?: string | null;
  receiverDocNumber?: string | null;
  receiverTaxCondition?: string | null;
  /** Las líneas. El paginado no las trae: se pueblan en el detalle por uuid y en el commit. */
  items?: OrderItemDto[] | null;
  /**
   * El desglose de promociones de la venta: qué promoción se aplicó, sobre qué línea y por cuánto.
   *
   * Lo trae **sólo el detalle** (`GET /order/uuid/{uuid}`) — el paginado no lo mapea, para no
   * disparar un N+1 —, así que una fila del listado nunca lo tiene aunque la venta haya tenido
   * descuentos. Vacío o ausente en la compra, que no lleva promociones.
   *
   * No cierra contra `orderCheckout.discountAmount`: ese es sólo el descuento de **ámbito total**
   * —la suma de las filas sin línea—, mientras que el de cada línea vive en su `discountAmount`.
   */
  promotions?: OrderPromotionDto[] | null;
  orderCheckout?: OrderCheckoutDto | null;
}

/** Un producto que no llega a cubrir lo pedido (`StockShortageDetail`). */
export interface StockShortageDetail {
  productUuid: string;
  productName: string;
  requestedQuantity: number;
  availableQuantity: number;
  deficit: number;
}

/** `StockValidationPolicy` de la sucursal. */
export const STOCK_VALIDATION_POLICIES = [
  'STRICT_BLOCK',
  'WARNING_CONFIRMATION',
  'FORCE_SALE',
] as const;

export type StockValidationPolicy = (typeof STOCK_VALIDATION_POLICIES)[number];

/**
 * Política por defecto cuando no se pudo leer la de la sucursal. Es la del medio a propósito: no
 * bloquea de más ni vende en negativo sin avisar, y ante la duda quien decide es el backend.
 */
export const DEFAULT_STOCK_VALIDATION_POLICY: StockValidationPolicy = 'WARNING_CONFIRMATION';

/** `StockValidationResult`, en `data.stockValidationWarning` del 409. */
export interface StockValidationWarning {
  policy?: StockValidationPolicy | string | null;
  requiresConfirmation?: boolean | null;
  shortages?: StockShortageDetail[] | null;
}

/**
 * El detalle de faltantes que viaja en el 409 de `WARNING_CONFIRMATION`, o `null` si el error es
 * otro. Es el único error del commit que trae datos estructurados: `STRICT_BLOCK` responde 400 con
 * los faltantes redactados dentro del mensaje, así que de ahí no se puede armar la misma vista.
 *
 * Sale de `data`, el objeto donde el backend adjunta los argumentos de un error. Antes era un campo
 * suelto en la raíz del cuerpo, armado por un handler propio del backend; ahora comparte contrato
 * con el resto de los errores con datos, como el `currentVersion` del 409 de concurrencia.
 *
 * Sólo lo mira la venta: el stock se valida únicamente cuando el comprobante **descuenta**, y los
 * de compra incrementan.
 */
export function readStockValidationWarning(error: unknown): StockValidationWarning | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) {
    return null;
  }

  const warning = readApiErrorData(error)?.['stockValidationWarning'] as
    StockValidationWarning | undefined;

  return warning?.shortages?.length ? warning : null;
}

/** `ExpiredBatchPolicy` de la sucursal (`stock.expiredPolicy`). */
export const EXPIRED_BATCH_POLICIES = ['BLOCK', 'WARN', 'ALLOW'] as const;

export type ExpiredBatchPolicy = (typeof EXPIRED_BATCH_POLICIES)[number];

/** Una partida vencida tal como viaja en `data.batches` del 400 `BATCH_EXPIRED`. */
export interface ExpiredBatchDetail {
  uuid: string;
  batchNumber?: string | null;
  /** `yyyy-MM-dd`. */
  expirationDate?: string | null;
  quantity?: number | null;
}

/** El `data` del 400 `BATCH_EXPIRED`: qué producto, bajo qué política y qué partidas vencidas. */
export interface ExpiredBatchError {
  productUuid: string | null;
  productName: string | null;
  policy: ExpiredBatchPolicy;
  /** `true` con `WARN`: se reintenta el mismo commit con `confirmExpiredOverride: true`. */
  confirmable: boolean;
  batches: ExpiredBatchDetail[];
}

/**
 * El detalle del 400 `BATCH_EXPIRED` (RN-04), o `null` si el error es otro. Lo produce la venta
 * cuando lo único con saldo del producto está vencido —o cuando el lote elegido a mano lo está— y
 * la sucursal no despacha vencidos: con `BLOCK` sólo se informa, con `WARN` se puede confirmar.
 */
export function readExpiredBatchError(error: unknown): ExpiredBatchError | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) {
    return null;
  }

  const data = readApiErrorData(error);
  if (!data || error.error?.errorCode !== 'BATCH_EXPIRED') {
    return null;
  }

  const rawBatches = Array.isArray(data['batches']) ? data['batches'] : [];
  const policy = data['policy'];

  return {
    productUuid: typeof data['productUuid'] === 'string' ? data['productUuid'] : null,
    productName: typeof data['productName'] === 'string' ? data['productName'] : null,
    policy: policy === 'WARN' || policy === 'ALLOW' ? policy : 'BLOCK',
    confirmable: data['confirmable'] === true,
    batches: rawBatches.flatMap((raw) => {
      if (typeof raw !== 'object' || raw === null) {
        return [];
      }
      const batch = raw as Record<string, unknown>;
      if (typeof batch['uuid'] !== 'string') {
        return [];
      }
      return [
        {
          uuid: batch['uuid'],
          batchNumber: typeof batch['batchNumber'] === 'string' ? batch['batchNumber'] : null,
          expirationDate:
            typeof batch['expirationDate'] === 'string' ? batch['expirationDate'] : null,
          quantity: typeof batch['quantity'] === 'number' ? batch['quantity'] : null,
        },
      ];
    }),
  };
}
