import { HttpErrorResponse } from '@angular/common/http';

/**
 * Stable error codes emitted by the backend (`CoreErrorCode` / `AppErrorCode`).
 *
 * `errorCode` is the field to branch on. The HTTP status is not enough — the API answers `409` for
 * the optimistic-locking conflict *and* for business conflicts that a reload does not fix (missing
 * stock, category in use, finalised batch, open cash session) — and both messages are free text
 * that gets reworded without notice.
 *
 * Full catalogue: `blue-productos/documentacion/endpoints/29_codigos_de_error.md`.
 */
export const API_ERROR_CODES = {
  /** The record changed in the database after the front read it. */
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  /** The access token expired: refresh it and retry the request. */
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',

  /*
   * Ajuste de stock (`POST /stock/adjustment`). Los dos primeros **no son fallas de datos**: son
   * preguntas del backend que el front contesta reintentando el mismo request con un campo más.
   */

  /**
   * El depósito tiene más de un lote con saldo y el ajuste no elige por su cuenta. `data` trae
   * `direction`, `delta`, `currentQuantity` y `batches`: se reintenta agregando `batchAllocations`.
   */
  ADJUSTMENT_BATCH_SELECTION_REQUIRED: 'ADJUSTMENT_BATCH_SELECTION_REQUIRED',
  /**
   * El saldo cambió entre que la pantalla lo leyó y llegó el request. `data` trae
   * `expectedQuantity` y `actualQuantity`: se relee la distribución antes de reintentar.
   */
  ADJUSTMENT_STALE_QUANTITY: 'ADJUSTMENT_STALE_QUANTITY',
  /** Se pidió descontar de un lote más de lo que tiene. `data`: `availableQuantity`, `requestedQuantity`. */
  ADJUSTMENT_BATCH_INSUFFICIENT: 'ADJUSTMENT_BATCH_INSUFFICIENT',
  /** El reparto entre lotes no suma la diferencia. `data`: `allocatedQuantity`, `requiredQuantity`. */
  ADJUSTMENT_BATCH_ALLOCATION_MISMATCH: 'ADJUSTMENT_BATCH_ALLOCATION_MISMATCH',

  /*
   * Lotes y vencimientos (Entrega B). Los tres primeros los produce cualquier ingreso de un
   * producto `BATCH` —compra, ajuste, recepción de traslado—; los dos siguientes, el egreso.
   */

  /** Un ingreso de un producto con partidas llegó sin número de lote. */
  BATCH_NUMBER_REQUIRED: 'BATCH_NUMBER_REQUIRED',
  /** El producto exige vencimiento (`expiration_control = REQUIRED`) y la partida no lo trae. */
  BATCH_EXPIRATION_REQUIRED: 'BATCH_EXPIRATION_REQUIRED',
  /** El reparto por lote de la línea no suma su cantidad. `data`: `allocatedQuantity`, `requiredQuantity`. */
  BATCH_ALLOCATION_MISMATCH: 'BATCH_ALLOCATION_MISMATCH',
  /**
   * La venta necesita despachar de un lote vencido y la sucursal no lo deja. `data` trae `policy`,
   * `confirmable` (`true` con `WARN`: se reintenta con `confirmExpiredOverride`) y `batches`.
   */
  BATCH_EXPIRED: 'BATCH_EXPIRED',
  /** El lote elegido a mano no existe, no es del producto, no está en la sucursal o no tiene saldo. */
  BATCH_NOT_AVAILABLE: 'BATCH_NOT_AVAILABLE',
  /** No hay lote activo con ese uuid en la empresa. */
  STOCK_BATCH_NOT_FOUND: 'STOCK_BATCH_NOT_FOUND',

  /*
   * Series (`stockTracking = SERIAL`). En este eje la cantidad de la línea no es un número que se
   * declara aparte: es la cantidad de unidades que se nombraron (RN-17).
   */

  /** La línea informó más o menos series que unidades. `data` trae `serials` y `quantity`. */
  SERIAL_COUNT_MISMATCH: 'SERIAL_COUNT_MISMATCH',
  /**
   * La misma serie aparece dos veces en la operación. Tiene código propio porque la unidad **sí**
   * está disponible: lo que no se puede es venderla dos veces.
   */
  SERIAL_DUPLICATED_IN_ORDER: 'SERIAL_DUPLICATED_IN_ORDER',
  /** La serie no existe para el producto, no está en stock o no está en la sucursal. */
  SERIAL_NOT_AVAILABLE: 'SERIAL_NOT_AVAILABLE',
  /** Se quiso ingresar una serie ya cargada para ese producto. */
  SERIAL_ALREADY_EXISTS: 'SERIAL_ALREADY_EXISTS',
  /** La consulta por número no encontró ninguna unidad. No es una falla: es una respuesta. */
  SERIAL_NOT_FOUND: 'SERIAL_NOT_FOUND',
  /** Sólo se devuelve lo vendido: la unidad tiene que estar `SOLD`. `data` trae `state`. */
  SERIAL_NOT_RETURNABLE: 'SERIAL_NOT_RETURNABLE',
  /** Sólo se reingresa lo devuelto: la unidad tiene que estar `RETURNED`. `data` trae `state`. */
  SERIAL_NOT_REINSTATABLE: 'SERIAL_NOT_REINSTATABLE',

  /*
   * Conversión de una orden de compra (`POST /order/{uuid}/convert`). Los tres significan que la
   * orden no es —o ya no es— convertible, y ninguno se arregla reintentando el mismo request.
   */

  /**
   * La orden ya tiene efectos aplicados: su comprobante mueve stock o balance, así que no es un
   * borrador y no hay nada que convertir. Lo que corresponde es releer el listado.
   */
  ORDER_ALREADY_APPLIED: 'ORDER_ALREADY_APPLIED',
  /** El comprobante de la orden no es de compra: sólo las compras se convierten. */
  ORDER_NOT_CONVERTIBLE: 'ORDER_NOT_CONVERTIBLE',
  /** No hay orden activa con ese uuid en la empresa. */
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',

  /*
   * Traslado de stock (`POST /stock-transfer/transfer`). El primero **no es una falla de datos**:
   * es una pregunta del backend que el front contesta reintentando el mismo request con
   * `forceTransfer: true`.
   */

  /**
   * El depósito de origen no tiene lo que el traslado mueve y la política de la sucursal
   * (`WARNING_CONFIRMATION`) pide confirmación antes de dejarlo en negativo. Llega como `412`.
   */
  STOCK_CONFIRMATION_REQUIRED: 'STOCK_CONFIRMATION_REQUIRED',
  /**
   * Lo mismo, pero con política `STRICT_BLOCK`: no hay confirmación que valga y el traslado se
   * rechaza. Llega como `409`.
   */
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  /** Sólo un usuario operando en la sucursal de destino confirma la recepción. Llega como `403`. */
  TRANSFER_RECEPTION_DENIED: 'TRANSFER_RECEPTION_DENIED',
  /** Cancelar es del origen, no del destino: la mercadería vuelve ahí. Llega como `403`. */
  TRANSFER_CANCELLATION_DENIED: 'TRANSFER_CANCELLATION_DENIED',
  /** El traslado ya no está en viaje: alguien lo recibió mientras la pantalla lo mostraba. */
  TRANSFER_STATE_INVALID: 'TRANSFER_STATE_INVALID',
  /** El reparto manual por lotes no suma la cantidad de la línea. */
  TRANSFER_BATCH_ALLOCATION_MISMATCH: 'TRANSFER_BATCH_ALLOCATION_MISMATCH',

  /**
   * El SKU enviado en `POST /product/save` ya lo usa otro producto **activo** de la empresa. La
   * unicidad no distingue mayúsculas ni espacios alrededor, así que reescribir el código no la
   * esquiva. `data`: `sku`, `productUuid` y `productName` del producto que lo ocupa.
   */
  PRODUCT_SKU_DUPLICATE: 'PRODUCT_SKU_DUPLICATE',
  /**
   * Un código de barras de la grilla ya lo usa otro producto **activo** de la empresa, o vino dos
   * veces en la misma grilla. `data`: `barcode`, y `productUuid` + `productName` del que lo ocupa
   * cuando el choque es contra otro producto.
   */
  DUPLICATE_PRODUCT_BARCODE: 'DUPLICATE_PRODUCT_BARCODE',
  DUPLICATE_SCALE_CODE: 'DUPLICATE_SCALE_CODE',
  /** `SERVICE` o `KIT` con control de existencias distinto de `NONE` (RN-01). */
  PRODUCT_TYPE_REQUIRES_NO_STOCK: 'PRODUCT_TYPE_REQUIRES_NO_STOCK',
  /** Control de vencimiento sin partidas ni series que lo guarden (RN-03). */
  EXPIRATION_REQUIRES_BATCH: 'EXPIRATION_REQUIRES_BATCH',
  /*
   * Composición de un kit (Entrega D). Todos son del `POST /product/save` salvo
   * `PRODUCT_IN_USE_BY_KIT`, que es del borrado, y `KIT_NOT_PURCHASABLE`, que es del commit.
   */
  /** Un `KIT` sin componentes: su disponible se deriva de las partes, y sin ellas no existe. */
  KIT_REQUIRES_COMPONENTS: 'KIT_REQUIRES_COMPONENTS',
  /** Componentes en un producto que no es `KIT`: nadie los explotaría al vender. `data`: `type`. */
  KIT_ITEMS_NOT_APPLICABLE: 'KIT_ITEMS_NOT_APPLICABLE',
  /** El componente no existe, está de baja o es de otra empresa. `data`: `componentUuid`. */
  KIT_COMPONENT_NOT_FOUND: 'KIT_COMPONENT_NOT_FOUND',
  /** El mismo componente vino dos veces. `data`: `componentName`, `componentUuid`. */
  KIT_COMPONENT_DUPLICATED: 'KIT_COMPONENT_DUPLICATED',
  /** Cantidad de componente en cero o negativa. `data`: `componentName`, `quantity`. */
  KIT_COMPONENT_QUANTITY_INVALID: 'KIT_COMPONENT_QUANTITY_INVALID',
  /** Los kits virtuales no se anidan (RN-10). `data`: `componentName`, `componentUuid`. */
  KIT_COMPONENT_CANNOT_BE_VIRTUAL_KIT: 'KIT_COMPONENT_CANNOT_BE_VIRTUAL_KIT',
  /** Un componente con `isForSale = false` dentro de un kit vendible. */
  KIT_COMPONENT_NOT_SELLABLE: 'KIT_COMPONENT_NOT_SELLABLE',
  /** El descuento de `SUM_COMPONENTS` fuera de 0..100. `data`: `percent`. */
  KIT_DISCOUNT_PERCENT_INVALID: 'KIT_DISCOUNT_PERCENT_INVALID',
  /**
   * Un kit no se compra, sea virtual o armado: el virtual no existe en ningún estante (§6.1) y el
   * armado se produce con un documento de armado que consume los componentes (§6.6). `data` trae
   * `productName`, `productUuid` y `kitMode`.
   */
  KIT_NOT_PURCHASABLE: 'KIT_NOT_PURCHASABLE',
  /** No se borra un producto que compone un kit. `data`: `kitName`, `kits`. */
  PRODUCT_IN_USE_BY_KIT: 'PRODUCT_IN_USE_BY_KIT',
  PACKAGING_DEFAULT_DUPLICATED: 'PACKAGING_DEFAULT_DUPLICATED',
  PACKAGING_FACTOR_INVALID: 'PACKAGING_FACTOR_INVALID',
  PACKAGING_NAME_REQUIRED: 'PACKAGING_NAME_REQUIRED',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  /**
   * El cambio de `stockTracking` no está entre las transiciones permitidas (RN-02): el producto
   * tiene saldo, o más de una partida. El `userMessage` trae el motivo concreto. `data`: `from`, `to`.
   */
  PRODUCT_STOCK_TRACKING_CHANGE_NOT_ALLOWED: 'PRODUCT_STOCK_TRACKING_CHANGE_NOT_ALLOWED',
  SCALE_FORMAT_NOT_CONFIGURED: 'SCALE_FORMAT_NOT_CONFIGURED',
  WEIGHABLE_REQUIRES_FRACTIONAL_UNIT: 'WEIGHABLE_REQUIRES_FRACTIONAL_UNIT',
  /** Se intentó ajustar o trasladar un producto que no lleva control de existencias. */
  PRODUCT_STOCK_NOT_TRACKED: 'PRODUCT_STOCK_NOT_TRACKED',
  /**
   * Se intentó ajustar o trasladar un kit **virtual**. Es la misma condición que
   * {@link PRODUCT_STOCK_NOT_TRACKED} —el `EXPLODE` está forzado a `stockTracking = NONE`— con
   * código propio porque la salida es otra: el combo no tiene existencias porque su disponible se
   * deriva de los componentes (RN-07), así que lo que hay que mover son ellos. El kit **armado** no
   * lo provoca: tiene saldo propio (RN-22). `data`: `productUuid`, `productName`, `kitMode`.
   */
  VIRTUAL_KIT_HAS_NO_STOCK: 'VIRTUAL_KIT_HAS_NO_STOCK',

  /*
   * Configuración jerárquica. Los dos primeros son de la clave y su valor, y los tres siguientes del
   * nivel: el catálogo de `/configuration/definitions` alcanza para no provocar ninguno, pero el
   * backend los valida igual y es quien manda (RN-06).
   */

  /** La clave no está en el registro del backend. `data`: `key`. */
  CONFIGURATION_KEY_UNKNOWN: 'CONFIGURATION_KEY_UNKNOWN',
  /**
   * El valor no lo parsea el tipo de la clave, o no pasa su validador. `data`: `key`, `value`,
   * `reason` y, en los selectores, `possibleValues`.
   */
  CONFIGURATION_VALUE_INVALID: 'CONFIGURATION_VALUE_INVALID',
  /** La clave no admite ese nivel: una de negocio en `GLOBAL`, una de sistema en `COMPANY`. */
  CONFIGURATION_SCOPE_NOT_ALLOWED: 'CONFIGURATION_SCOPE_NOT_ALLOWED',
  /** Vinieron varios dueños, o el `scope` no coincide con el uuid enviado. */
  CONFIGURATION_SCOPE_AMBIGUOUS: 'CONFIGURATION_SCOPE_AMBIGUOUS',
  /** El dueño del nivel —empresa, sucursal o usuario— no existe. */
  CONFIGURATION_SCOPE_ENTITY_NOT_FOUND: 'CONFIGURATION_SCOPE_ENTITY_NOT_FOUND',
  /** No alcanza el permiso para escribir ese nivel, o se intenta leer otra empresa. */
  CONFIGURATION_ACCESS_DENIED: 'CONFIGURATION_ACCESS_DENIED',
  /** La clave es privada: no se sirve a quien no puede verla. */
  CONFIGURATION_VARIABLE_PRIVATE: 'CONFIGURATION_VARIABLE_PRIVATE',

  /*
   * Variantes (Entrega C). La variante es un producto (RN-11): estos códigos son del catálogo de
   * ejes y de la matriz, no del producto, que sigue devolviendo los suyos sin cambios.
   */

  /** Ya existe un eje con ese nombre en la empresa (sin distinguir mayúsculas). `data`: `name`. */
  OPTION_NAME_DUPLICATED: 'OPTION_NAME_DUPLICATED',
  /** Dos valores iguales en el mismo eje. `data`: `optionName`, `value`. */
  OPTION_VALUE_DUPLICATED: 'OPTION_VALUE_DUPLICATED',
  /**
   * Se quiso borrar un valor —o un eje— que usan variantes o modelos activos (RN-15): se desactiva.
   * `data`: `value` + `variants`, o `name` + `models`. Es el mismo código para los dos casos.
   */
  OPTION_VALUE_IN_USE: 'OPTION_VALUE_IN_USE',
  /** El valor que la matriz eligió no existe, está desactivado o no es de un eje del modelo. */
  OPTION_VALUE_NOT_FOUND: 'OPTION_VALUE_NOT_FOUND',
  /** Un modelo sin ejes no agrupa nada: su matriz sería una fila sin columnas. `data`: `modelName`. */
  MODEL_REQUIRES_OPTIONS: 'MODEL_REQUIRES_OPTIONS',
  /** Un eje del modelo del que no se eligió ningún valor: el cartesiano daría cero filas. */
  MODEL_OPTION_REQUIRES_VALUES: 'MODEL_OPTION_REQUIRES_VALUES',
  /** El mismo eje dos veces en un modelo. `data`: `optionName`. */
  MODEL_OPTION_DUPLICATED: 'MODEL_OPTION_DUPLICATED',
  /**
   * Una variante que no fija exactamente un valor por cada eje (RN-14): no se puede dibujar en la
   * grilla ni elegir en el POS. `data`: `variantName`, `expected`, `received`.
   */
  VARIANT_INCOMPLETE: 'VARIANT_INCOMPLETE',
  /** Dos «M / Rojo» en el mismo modelo (RN-14). `data`: `combination`. */
  PRODUCT_VARIANT_COMBINATION_DUPLICATED: 'PRODUCT_VARIANT_COMBINATION_DUPLICATED',
  /** El modelo tiene variantes con movimientos: se desactivan, no se borra. `data`: `variants`. */
  MODEL_IN_USE: 'MODEL_IN_USE',

  /*
   * Campos extra de empleado (`/employee-attribute`). El catálogo es por empresa y comparte el
   * sistema de tipos con los atributos de categoría.
   */

  /** Ya hay un campo vigente con ese nombre, sin distinguir mayúsculas. `data`: `attributeUuid`. */
  EMPLOYEE_ATTRIBUTE_DUPLICATE: 'EMPLOYEE_ATTRIBUTE_DUPLICATE',
  /**
   * Se quiso cambiar el tipo de un campo que ya está completado en algún empleado: esos valores se
   * validaron contra el tipo viejo. `data`: `attributeUuid` y `values`, cuántos empleados lo
   * tienen.
   */
  EMPLOYEE_ATTRIBUTE_TYPE_LOCKED: 'EMPLOYEE_ATTRIBUTE_TYPE_LOCKED',

  /*
   * El directorio: la ficha, su vínculo y su usuario. Los «ya existe» **no son fallas de datos**: cada
   * uno trae en `data` lo que hace falta para seguir —sumarle el vínculo a la ficha que ya está, abrir
   * la que ya tiene ese vínculo, vincular el usuario que ya existe—.
   */

  /** El documento ya es de otra ficha de la empresa. `data.partyUuid`: la ficha, para sumarle el vínculo. */
  PARTY_DOCUMENT_ALREADY_EXISTS: 'PARTY_DOCUMENT_ALREADY_EXISTS',
  /**
   * La ficha ya tiene ese vínculo: es un duplicado de verdad. `data`: `partyUuid` y `partyRoleUuid`, la
   * ficha del vínculo que hay que abrir.
   */
  PARTY_ROLE_ALREADY_EXISTS: 'PARTY_ROLE_ALREADY_EXISTS',
  /** Un empleado sin especialidad no se da de alta: el alta es por tipo. */
  EMPLOYEE_SPECIALTY_REQUIRED: 'EMPLOYEE_SPECIALTY_REQUIRED',
  /** El empleado ya tiene esa especialidad. `data`: `specialty`, `specialtyUuid`. */
  EMPLOYEE_SPECIALTY_ALREADY_EXISTS: 'EMPLOYEE_SPECIALTY_ALREADY_EXISTS',
  /** El legajo tipeado lo tiene otro empleado vigente. `data`: `fileNumber`, `employeeUuid`. */
  EMPLOYEE_FILE_NUMBER_DUPLICATE: 'EMPLOYEE_FILE_NUMBER_DUPLICATE',
  /** El alta compuesta de un empleado llegó sin usuario: en los tres tipos es obligatorio. */
  EMPLOYEE_USER_REQUIRED: 'EMPLOYEE_USER_REQUIRED',
  /** La forma del alta compuesta no es válida. `data.field`: el campo. */
  PARTY_ONBOARD_INVALID: 'PARTY_ONBOARD_INVALID',
  /** La ficha ya tiene otro usuario. `data`: `userUuid` y `username`, el que tiene: se edita ése. */
  PARTY_ALREADY_HAS_USER: 'PARTY_ALREADY_HAS_USER',
  /**
   * El nombre de usuario ya existe. `data.userUuid` viene **sólo** si ese usuario entra a esta empresa:
   * es lo que habilita ofrecer «vincular el que existe» sin revelar usuarios ajenos.
   */
  PARTY_USER_ALREADY_EXISTS: 'PARTY_USER_ALREADY_EXISTS',
  /** El usuario ya está vinculado a otra ficha de la empresa. `data.partyUuid`: la otra. */
  PARTY_USER_ALREADY_LINKED: 'PARTY_USER_ALREADY_LINKED',
  /** El pedido de vínculo está incompleto o mezcla usuario nuevo y existente. `data.field`: el campo. */
  PARTY_USER_LINK_INVALID: 'PARTY_USER_LINK_INVALID',
  /** El usuario no entra a esta empresa: para quien no es SysAdmin, uno ajeno no existe. */
  PARTY_USER_NOT_FOUND: 'PARTY_USER_NOT_FOUND',
  /** Un rol que no existe o que es de otra empresa. */
  PARTY_USER_ROLE_NOT_FOUND: 'PARTY_USER_ROLE_NOT_FOUND',
  /** Quien pertenece a la empresa sistema tiene su ficha ahí, y sólo ahí. */
  PARTY_USER_SYSTEM_SCOPED: 'PARTY_USER_SYSTEM_SCOPED',
  /**
   * Se quiso otorgar un rol con un permiso que quien lo otorga no tiene. Llega como `403` y es la
   * antiescalación del ABM de usuarios: la pantalla lo muestra, no lo esconde.
   */
  PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
  /** Un rol que no se otorga desde una empresa —uno de otra empresa, o uno reservado—. */
  USER_MANAGEMENT_NOT_ALLOWED: 'USER_MANAGEMENT_NOT_ALLOWED',
  /**
   * Los roles que se le dan a la persona la hacen ser un vínculo que no tiene ni viene en el pedido: el cliente
   * con un rol de reparto es transportista, y sin sus datos no se guarda nada. `data.missing`: los vínculos.
   */
  PARTY_LINKS_MISSING: 'PARTY_LINKS_MISSING',
  /** Un vínculo del pedido no existe, vino dos veces o la ficha ya lo tiene. `data.link`: cuál. */
  PARTY_LINK_INVALID: 'PARTY_LINK_INVALID',
  /** Un CUIT de sociedad no es una persona: no puede ser empleado. `data.partyUuid`, si la ficha ya existía. */
  EMPLOYEE_IDENTITY_NOT_A_PERSON: 'EMPLOYEE_IDENTITY_NOT_A_PERSON',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/** Common error body returned by the Core `CustomRestExceptionHandler`. */
export interface ApiErrorBody {
  cause?: unknown;
  stackTrace?: unknown[];
  localTime?: string;
  status?: string;
  /** Stable machine-readable code. Prefer it over matching message strings. */
  errorCode?: string;
  userMessage?: string;
  developerMessage?: string;
  errores?: unknown[];
  /** Arguments of the error, when it carries any. Absent from errors that attach none. */
  data?: Record<string, unknown> | null;
  message?: string;
  suppressed?: unknown[];
  localizedMessage?: string;
}

/** The API error body of a failed request, or `null` when the failure has another shape. */
export function readApiErrorBody(error: unknown): ApiErrorBody | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }

  if (typeof error.error !== 'object' || error.error === null) {
    return null;
  }

  return error.error as ApiErrorBody;
}

/** `true` when the failure is the API error carrying exactly that `errorCode`. */
export function hasApiErrorCode(error: unknown, code: ApiErrorCode): boolean {
  return readApiErrorBody(error)?.errorCode === code;
}

/**
 * The `data` object of an API error, or `null` when the failure carries none.
 *
 * `errorCode` says *which* error it is; `data` says *with what*. It is where the backend puts the
 * arguments the client needs to resolve the failure — the version a conflicting record has in the
 * database, the shortages behind a stock warning — so they are read as fields instead of being
 * parsed out of `developerMessage`, which is prose and gets reworded without notice.
 *
 * A key that is missing means the backend could not report it: it is never sent as `null`.
 */
export function readApiErrorData(error: unknown): Record<string, unknown> | null {
  const data = readApiErrorBody(error)?.data;
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  return data;
}

/** Best-effort user-facing message from an API failure, else `fallback`. */
export function resolveApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) {
    return fallback;
  }

  if (typeof error.error === 'string' && error.error.trim()) {
    return error.error;
  }

  const body = readApiErrorBody(error);
  if (!body) {
    return fallback;
  }

  return body.userMessage?.trim() || body.message?.trim() || fallback;
}
