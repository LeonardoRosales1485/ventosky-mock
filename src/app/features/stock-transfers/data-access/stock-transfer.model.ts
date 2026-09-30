import { Permissions } from '../../../core/auth/permissions';

/**
 * El modelo del traslado tal como lo devuelve la API, y las preguntas que la pantalla le hace.
 *
 * Un traslado es un movimiento de stock entre dos depósitos —del mismo depósito de la sucursal o de
 * otra sucursal de la empresa— y tiene una particularidad que ordena toda la feature: **lo que está
 * en viaje ya salió del origen y no existe en el destino**. No está en ningún saldo, no se puede
 * vender y no se puede volver a trasladar hasta que alguien lo recibe.
 */

/** Estado del traslado, tal como lo persiste el backend en `transfer_status`. */
export type TransferStatus = 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

/**
 * Modalidad de entrega.
 *
 * - `DEFERRED`: descuenta del origen ahora y queda en viaje; el destino lo ingresa al confirmar.
 * - `IMMEDIATE`: descuenta y acredita en una sola operación, sin paso de recepción.
 *
 * Las dos valen para un traslado interno y para uno entre sucursales.
 */
export type TransferMode = 'DEFERRED' | 'IMMEDIATE';

/** `UuidNameDTO`: la referencia mínima con la que viajan depósito, sucursal, producto y usuario. */
export interface TransferRef {
  uuid: string;
  name: string;
}

/** Fila de `POST /stock-transfer/paginate` (`StockTransferPaginateDTO`). */
export interface StockTransferRow {
  uuid: string;
  /** El número visible, `TR-000148`. Un traslado viejo sin numerar viene sin él. */
  publicId?: string | null;
  transferStatus: TransferStatus;
  transferMode: TransferMode;
  fromWarehouse?: TransferRef | null;
  toWarehouse?: TransferRef | null;
  sourceBranch?: TransferRef | null;
  targetBranch?: TransferRef | null;
  /** Sólo cuando el traslado mueve un producto; en uno de varios viene nulo. */
  product?: TransferRef | null;
  /** Total de unidades, sumadas las líneas de todos los productos. */
  quantity?: number | null;
  /** Productos distintos. Las líneas pueden ser más: hay una por lote de origen. */
  productCount?: number | null;
  dispatchedByUser?: TransferRef | null;
  receivedByUser?: TransferRef | null;
  dateReceived?: string | null;
  /** Quién canceló el traslado, y cuándo. Sólo los lleva un traslado cancelado. */
  cancelledByUser?: TransferRef | null;
  dateCancelled?: string | null;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string | null;
}

/** Una línea del traslado: **un lote de origen**, con lo que el destino necesita para recrearlo. */
export interface StockTransferLine {
  uuid?: string;
  product?: TransferRef | null;
  productSku?: string | null;
  quantity?: number | null;
  /**
   * Número de la partida de origen, o **nulo** en un producto que no las maneja.
   *
   * El backend no manda el lote `UNICO` con el que sostiene ese saldo: es cómo se guarda el saldo,
   * no una partida que el operador pueda reconocer, y en la columna «Lote» hacía creer que el
   * producto lleva partidas cuando no las lleva.
   */
  batchNumber?: string | null;
  expirationDate?: string | null;
  unitCost?: number | null;
  /**
   * Los números de las unidades que llevó la línea, ordenados. Vacío en todo producto que no lleva
   * series.
   *
   * Lo dice el traslado y no la unidad: al recibirlo la serie vuelve a estar `IN_STOCK` y deja de
   * apuntar a ninguna salida, así que preguntárselo a ella dejaría el remito de un traslado
   * recibido en blanco. Es el dato que el depósito de destino chequea contra las cajas.
   */
  serials?: string[] | null;
  /**
   * Unidad de medida del producto (`UNIT`, `KILOGRAM`, …), para poder leer {@link quantity}. Nula
   * si el producto no la declara.
   */
  unitMeasure?: string | null;
}

/**
 * Si alguna línea trae partida. Es lo que decide si la columna «Lote» va: en un traslado de
 * productos que no llevan partidas, una columna entera de guiones ocupa lugar para no decir nada.
 */
export function anyLineHasBatch(lines: readonly StockTransferLine[] | null | undefined): boolean {
  return (lines ?? []).some((line) => !!line.batchNumber);
}

/** Lo mismo para «Vencimiento»: una partida puede llevar número y no vencer. */
export function anyLineHasExpiration(
  lines: readonly StockTransferLine[] | null | undefined,
): boolean {
  return (lines ?? []).some((line) => !!line.expirationDate);
}

/**
 * Cuántas unidades entran en la fila antes de resumirlas en un botón.
 *
 * El caso común de un traslado de electro son dos o tres equipos, y ahí los números sueltos
 * responden la pregunta sin un solo clic. Cuarenta notebooks convierten la fila en un muro y la
 * tabla deja de leerse, y ahí el clic vale lo que cuesta.
 */
export const SERIALS_INLINE_LIMIT = 5;

/** Si las series de la línea entran en la fila. Falso también cuando no hay ninguna. */
export function serialsFitInline(line: StockTransferLine): boolean {
  const count = line.serials?.length ?? 0;
  return count > 0 && count <= SERIALS_INLINE_LIMIT;
}

/** Si hay series pero son demasiadas para la fila: van resumidas y se abren en un diálogo. */
export function serialsNeedDialog(line: StockTransferLine): boolean {
  return (line.serials?.length ?? 0) > SERIALS_INLINE_LIMIT;
}

/**
 * La clave i18n de la abreviatura de la unidad, o `null` si el producto no declara ninguna.
 *
 * Es una clave y no la abreviatura que manda el backend porque el texto que se imprime al lado del
 * número es de la pantalla: en inglés «un» no es «un». Nulo se dibuja como el número pelado —
 * inventarle «u.» a un producto sin unidad escribiría «unidades» al lado de lo que puede ser un
 * peso.
 */
export function unitAbbrevKey(line: StockTransferLine): string | null {
  return line.unitMeasure ? `products.unitAbbrev.${line.unitMeasure}` : null;
}

/**
 * El detalle (`GET /stock-transfer/uuid/{uuid}`). Es la única lectura que trae las líneas y el
 * membrete del remito: el remito no es otra consulta, es este mismo detalle impreso.
 */
export interface StockTransferDetail extends StockTransferRow {
  lines?: StockTransferLine[] | null;
  companyName?: string | null;
  companyCuit?: string | null;
  sourceBranchAddress?: string | null;
  targetBranchAddress?: string | null;
}

/**
 * Lo que la sucursal activa tiene en viaje (`GET /stock-transfer/summary`). Es un total de la
 * sucursal y no de la página: el aviso del listado dice cuántos hay, no cuántos se ven.
 */
export interface StockTransferSummary {
  /** Traslados en viaje cuyo destino es esta sucursal: los que esperan que alguien de acá reciba. */
  pendingReception?: number | null;
  /** Los que salieron de acá y todavía no llegaron a ningún depósito. */
  inTransitOut?: number | null;
}

/** Lote con saldo en el depósito de origen (`GET /stock-transfer/source-batches`). */
export interface TransferSourceBatch {
  uuid: string;
  batchNumber?: string | null;
  expirationDate?: string | null;
  availableQuantity?: number | null;
  unitCost?: number | null;
  /**
   * La partida venció: su fecha es **anterior** a hoy — la que vence hoy todavía sale (RN-04). Es un
   * hecho de la partida, no una decisión: alcanza para el semáforo.
   */
  expired?: boolean | null;
  /**
   * Además de vencida, la política de la sucursal (`stock.expiredPolicy`) no la deja salir.
   *
   * Es el campo que la pantalla tiene que mirar para **no sumarla al disponible**: el despacho
   * descuenta contra el saldo sin los bloqueados, así que contarlos acá inventa stock que el backend
   * no va a encontrar y el operador se entera con un `412` por un faltante que no ve. Es distinto de
   * {@link expired} porque con `WARN` y con `ALLOW` una partida vencida sí se despacha, y ahí lo que
   * corresponde es avisar sin prohibir.
   */
  blocked?: boolean | null;
}

/** Cuánto sale de un lote concreto, cuando el operador repartió a mano. */
export interface TransferBatchAllocationPayload {
  batchUuid: string;
  quantity: number;
}

/** Un producto del despacho. Sin `allocations`, decide la política de asignación de la sucursal. */
export interface TransferItemPayload {
  product: { uuid: string };
  quantity: number;
  allocations?: TransferBatchAllocationPayload[];
  /**
   * Los números de las unidades que se van, **obligatorio** con `stockTracking = SERIAL` y tantos
   * como `quantity` (RN-17).
   *
   * No convive con {@link allocations}: con series no hay nada que repartir, porque la unidad ya
   * dice de qué partida sale. Por eso mismo tampoco pide `stock.batch_select` — el operador no
   * eligió una partida, eligió qué notebook se manda.
   */
  serials?: string[];
}

/** Body de `POST /stock-transfer/transfer`. */
export interface StockTransferDispatchPayload {
  fromWarehouse: { uuid: string };
  toWarehouse: { uuid: string };
  transferMode: TransferMode;
  items: TransferItemPayload[];
  /**
   * Reintento tras un `412`: la sucursal pide confirmación antes de dejar un depósito en negativo.
   * No se manda de entrada — el 412 es justamente lo que abre el diálogo que lo pide.
   */
  forceTransfer?: boolean;
}

export const TRANSFER_VIEW_PERMISSION = Permissions.transferView;
export const TRANSFER_DISPATCH_PERMISSION = Permissions.transferDispatch;
/**
 * Cancelar exige el mismo permiso que despachar, y no uno propio, porque es la operación inversa:
 * devuelve al depósito de origen lo que el despacho sacó de ahí. Quien puede sacar mercadería de un
 * depósito puede volver a meterla; separarlo en un `transfer.cancel` sería un permiso que ningún rol
 * tiene todavía, o sea una acción muerta para todos.
 */
export const TRANSFER_CANCEL_PERMISSION = Permissions.transferDispatch;
export const TRANSFER_RECEIVE_PERMISSION = Permissions.transferReceive;
export const TRANSFER_VIEW_ALL_BRANCHES_PERMISSION = Permissions.stockViewAllBranches;

/**
 * Sólo un traslado en viaje se recibe. `IMMEDIATE` nunca lo está —nace recibido— y un cancelado no
 * vuelve.
 */
export function isReceivable(transfer: StockTransferRow): boolean {
  return transfer.transferStatus === 'IN_TRANSIT';
}

/**
 * Si además **esta** sucursal puede recibirlo. El permiso no alcanza: el backend rechaza la
 * confirmación desde cualquier sucursal que no sea la de destino, así que el botón se apaga acá en
 * vez de dejar que el usuario descubra el 403.
 */
export function isReceivableHere(
  transfer: StockTransferRow,
  activeBranchUuid: string | null,
): boolean {
  return (
    isReceivable(transfer) &&
    activeBranchUuid !== null &&
    transfer.targetBranch?.uuid === activeBranchUuid
  );
}

/**
 * Sólo un traslado en viaje se cancela. Uno recibido ya acreditó el destino y arrastró su costo y
 * sus precios: deshacer eso no es cancelar, es otra operación.
 */
export function isCancellable(transfer: StockTransferRow): boolean {
  return transfer.transferStatus === 'IN_TRANSIT';
}

/**
 * Si además **esta** sucursal puede cancelarlo. Es el espejo de {@link isReceivableHere}: la
 * recepción la confirma el destino porque es ahí donde entra la mercadería, y la cancelación la
 * hace el origen porque es ahí donde vuelve. El backend rechaza cualquier otra sucursal, así que el
 * botón se apaga acá en vez de dejar que el usuario descubra el 403.
 */
export function isCancellableHere(
  transfer: StockTransferRow,
  activeBranchUuid: string | null,
): boolean {
  return (
    isCancellable(transfer) &&
    activeBranchUuid !== null &&
    transfer.sourceBranch?.uuid === activeBranchUuid
  );
}

/** Un traslado cancelado no tiene remito: nunca movió mercadería. */
export function hasRemito(transfer: StockTransferRow): boolean {
  return transfer.transferStatus !== 'CANCELLED';
}
