import { Permissions } from '../../../core/auth/permissions';
import { Versioned } from '../../../core/concurrency/version-conflict.model';
import { UuidNameRef } from '../../../core/http/api-refs';
import { FilterMatchMode, PaginationFilterConstraint } from '../../../core/paginate';
import { PromotionScope, PromotionType } from '../../../core/pricing/promotion-engine';

/**
 * Los dos enums los declara el **motor replicado** (`core/pricing/promotion-engine`), que es quien
 * tiene que coincidir carácter por carácter con el Java: el ABM habla de lo mismo que el motor
 * evalúa, así que los importa en vez de declararlos otra vez.
 */
export type { PromotionScope, PromotionType } from '../../../core/pricing/promotion-engine';

/**
 * Los mismos tres tipos como lista, que es lo que el selector del formulario y el filtro del listado
 * recorren. `satisfies` los ata al enum del motor: un valor que el motor no conozca no compila.
 */
export const PROMOTION_TYPES = [
  'PERCENTAGE',
  'FIXED_AMOUNT',
  'NXM',
] as const satisfies readonly PromotionType[];

export const DEFAULT_PROMOTION_TYPE: PromotionType = 'PERCENTAGE';

/**
 * Interruptor **temporal y sólo del front**: apagado, el ABM ofrece únicamente la promoción
 * porcentual y esconde el importe fijo y la NxM. Prenderlo vuelve a ofrecer los tres, y es lo único
 * que hay que tocar — no hay nada más que revertir.
 *
 * **No apaga la funcionalidad, apaga la oferta.** El backend sigue aceptando los tres tipos, el
 * motor replicado los sigue evaluando y una promoción ya guardada de cualquier tipo se sigue
 * mostrando, calculando y editando. Lo único que se restringe es qué puede **elegir** quien está
 * creando una promoción nueva.
 *
 * Por eso no se toca {@link PROMOTION_TYPES}: esa lista es lo que el sistema **conoce** —de ella
 * dependen el chip del listado, el desglose de la venta y la restauración del filtro desde la URL— y
 * ésta es lo que la pantalla **ofrece**. Acotar la segunda no puede acotar la primera: dejaría sin
 * dibujar promociones que ya existen.
 */
export const ALL_PROMOTION_TYPES_ENABLED = false;

/** Los tipos que hoy ofrecen el selector del formulario y el filtro del listado. */
export const SELECTABLE_PROMOTION_TYPES: readonly PromotionType[] = ALL_PROMOTION_TYPES_ENABLED
  ? PROMOTION_TYPES
  : ['PERCENTAGE'];

/**
 * Los tipos que un selector tiene que dibujar dado el que ya está elegido: los ofrecidos, más el
 * actual si quedó fuera.
 *
 * Existe por un caso que no se puede romper: una NxM guardada **antes** de apagar el interruptor.
 * Sin su propia opción el select abriría en blanco, y el primer cambio en cualquier otro campo la
 * guardaría convertida en un porcentaje — el interruptor esconde tipos, no reescribe promociones.
 * Un tipo que ni siquiera está en {@link PROMOTION_TYPES} cae en la misma rama, así que un cuarto
 * tipo que el backend sume mañana se muestra en vez de desaparecer.
 *
 * Sin tipo elegido devuelve la lista tal cual: es el filtro del listado en blanco.
 */
export function typeOptionsFor(currentType: string | null | undefined): readonly string[] {
  if (!currentType || SELECTABLE_PROMOTION_TYPES.some((type) => type === currentType)) {
    return SELECTABLE_PROMOTION_TYPES;
  }

  return [...SELECTABLE_PROMOTION_TYPES, currentType];
}

/** Dónde se resta la plata, que no es lo mismo que a qué productos alcanza. */
export const PROMOTION_SCOPES = [
  'PRODUCTS',
  'ORDER_TOTAL',
] as const satisfies readonly PromotionScope[];

export const DEFAULT_PROMOTION_SCOPE: PromotionScope = 'PRODUCTS';

/**
 * El estado de una promoción, en el orden en que el filtro los ofrece: de lo que está descontando
 * hoy a lo que ya no.
 *
 * **No es una columna** (`PromotionState` del backend): programada, vigente y vencida las trae el
 * calendario y discontinuada el interruptor manual, así que se deriva con {@link promotionStateOf}.
 */
export const PROMOTION_STATES = ['ACTIVE', 'SCHEDULED', 'EXPIRED', 'DISCONTINUED'] as const;

export type PromotionState = (typeof PROMOTION_STATES)[number];

/** Cota superior del porcentaje: el backend rechaza un descuento mayor al precio (`0 < p ≤ 100`). */
export const PERCENT_MAX = 100;

/**
 * Una promoción (`PromotionDTO`), tal como la devuelven el paginado y el detalle. El paginado trae
 * las cinco colecciones, así que el listado resume el alcance sin releer cada fila por uuid.
 *
 * Las cinco son vínculos simples y **vacía significa «todas»**, no «ninguna»: sin clientes aplica a
 * cualquiera, sin sucursales en todas, sin medios de pago no mira los pagos. El conjunto elegible
 * —productos ∪ categorías— es la excepción: con ámbito de productos tiene que ser no vacío.
 */
export interface PromotionDto extends Versioned {
  uuid: string;
  name: string;
  description?: string | null;
  /**
   * `PromotionType` y `PromotionScope` como los manda el backend, y **a propósito `string`** y no la
   * unión: el enum lo gobierna el Java, y si mañana suma un cuarto tipo, esta pantalla tiene que
   * poder mostrar esa fila y reenviarla intacta. Tipar el cable con la unión obligaría a normalizar
   * lo desconocido al hidratar, y guardar la degradaría en silencio a un porcentaje.
   */
  type?: string | null;
  scope?: string | null;
  percent?: number | null;
  amount?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  /** `YYYY-MM-DD`: un día completo en GMT-3, no un instante. */
  validFrom?: string | null;
  /** `YYYY-MM-DD`. Ausente ⇒ sin vencimiento. */
  validUntil?: string | null;
  isDiscontinued?: boolean | null;
  isCombinable?: boolean | null;
  /**
   * Estado derivado que el backend calcula contra **su** hoy y manda de sólo lectura.
   *
   * La pantalla no lo usa: deriva el suyo con {@link promotionStateOf}. No es desconfianza, es
   * consistencia — el filtro del listado se arma contra el hoy del navegador, y mezclar los dos
   * «hoy» produciría una fila que se contradice con el filtro que la trajo.
   */
  state?: string | null;
  products?: UuidNameRef[] | null;
  categories?: UuidNameRef[] | null;
  /** Audiencia: roles cliente (`party_roles` con rol `CUSTOMER`), nombrados por su tercero. */
  customers?: UuidNameRef[] | null;
  branches?: UuidNameRef[] | null;
  paymentMethods?: UuidNameRef[] | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

/**
 * Body de `POST /promotion/save`.
 *
 * Los parámetros de los tres tipos viajan **siempre**, los del tipo elegido con valor y los otros en
 * `null`: el backend valida que ninguno sobre (V9), así que un campo ausente tiene que poder borrar
 * el valor que dejó el tipo anterior. Lo mismo con las cinco colecciones: se sincronizan con lo
 * recibido, así que omitir una dejaría los vínculos viejos en pie.
 */
export interface PromotionSavePayload {
  uuid?: string;
  /** Versión leída al hidratar el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
  name: string;
  description: string | null;
  type: string;
  scope: string;
  percent: number | null;
  amount: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  validFrom: string;
  validUntil: string | null;
  isDiscontinued: boolean;
  isCombinable: boolean;
  products: { uuid: string }[];
  categories: { uuid: string }[];
  customers: { uuid: string }[];
  branches: { uuid: string }[];
  paymentMethods: { uuid: string }[];
}

/**
 * Lo que el formulario tiene cargado. Es el modelo de la pantalla y la entrada de las validaciones:
 * las reglas se prueban contra esto, no contra el DOM ni contra Signal Forms.
 */
export interface PromotionFormValue {
  name: string;
  description: string;
  type: string;
  scope: string;
  percent: number | null;
  amount: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  /** `YYYY-MM-DD`. Vacío es «sin cargar»: lo rechaza {@link promotionValidationIssues}. */
  validFrom: string;
  validUntil: string | null;
  isDiscontinued: boolean;
  isCombinable: boolean;
  productUuids: string[];
  /** Sólo las raíces elegidas: sus subcategorías se derivan, no se guardan. */
  categoryUuids: string[];
  customerUuids: string[];
  branchUuids: string[];
  paymentMethodUuids: string[];
}

/** Producto devuelto por el buscador del conjunto elegible (`POST /product/paginate`). */
export interface ProductOption {
  uuid: string;
  name: string;
  sku?: string | null;
}

/** Cliente candidato a audiencia: el rol `CUSTOMER` del maestro unificado de terceros. */
export interface CustomerOption {
  uuid: string;
  name: string;
  docNumber?: string | null;
}

export const PROMOTION_VIEW_PERMISSION = Permissions.promotionView;
export const PROMOTION_CREATE_PERMISSION = Permissions.promotionCreate;
export const PROMOTION_EDIT_PERMISSION = Permissions.promotionEdit;
export const PROMOTION_DELETE_PERMISSION = Permissions.promotionDelete;

/* ────────────────────────────  Derivaciones del listado  ──────────────────────────── */

/**
 * El estado de la promoción contra una fecha, con el **mismo orden de evaluación** que
 * `PromotionState.of` del backend: el interruptor manual gana sobre el calendario.
 *
 * Las fechas se comparan **como texto**, igual que en el motor: son días completos, y en ISO el
 * orden lexicográfico es el cronológico. Pasarlas por `Date` sólo agregaría una zona horaria que del
 * otro lado no existe.
 */
export function promotionStateOf(promotion: PromotionDto, today: string): PromotionState {
  if (promotion.isDiscontinued === true) {
    return 'DISCONTINUED';
  }

  const day = dayOf(today);
  const from = dayOf(promotion.validFrom);
  if (from && day && day < from) {
    return 'SCHEDULED';
  }

  const until = dayOf(promotion.validUntil);
  return until && day && day > until ? 'EXPIRED' : 'ACTIVE';
}

/**
 * Si la fila se dibuja atenuada: lo que hoy no descuenta nada. **No se esconde** —hay que poder
 * reactivar una vencida que funcionó bien—, pero tampoco puede competir de igual a igual con las
 * que sí están moviendo plata.
 */
export function isPromotionDimmed(state: PromotionState): boolean {
  return state === 'EXPIRED' || state === 'DISCONTINUED';
}

/**
 * El chip del tipo, como descriptor y no como texto: los números salen acá y el formato —el símbolo
 * de moneda, el separador decimal— lo pone la plantilla con el locale activo.
 *
 * `UNKNOWN` cubre la fila que llega con el tipo o sus parámetros incompletos: el listado la dibuja
 * igual, porque esconderla sería esconder una promoción que el motor podría estar aplicando.
 */
export type PromotionTypeChip =
  | { kind: 'PERCENTAGE'; percent: number }
  | { kind: 'FIXED_AMOUNT'; amount: number }
  | { kind: 'NXM'; buyQuantity: number; payQuantity: number }
  | { kind: 'UNKNOWN' };

export function promotionTypeChipOf(promotion: PromotionDto): PromotionTypeChip {
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
 * El conjunto elegible resumido en una línea: cuántos productos y cuántas categorías. Con ámbito de
 * total no hay conjunto —alcanza la venta entera—, y por eso el ámbito viaja con los dos números.
 */
export interface PromotionEligibleSet {
  scope: string;
  products: number;
  categories: number;
}

export function eligibleSetOf(promotion: PromotionDto): PromotionEligibleSet {
  return {
    scope: promotion.scope ?? '',
    products: promotion.products?.length ?? 0,
    categories: promotion.categories?.length ?? 0,
  };
}

/* ────────────────────────────  Filtro del listado  ──────────────────────────── */

/**
 * El eje de circulación del listado, que es la mitad del estado que el paginado **sí** puede
 * filtrar: `is_discontinued` es una columna booleana.
 *
 * Las otras tres —programada, vigente, vencida— se derivan comparando `valid_from` / `valid_until`
 * contra hoy, y el paginado del Core no las puede filtrar: bindea el valor como `varchar` y Postgres
 * no tiene operador `date >= varchar` (sólo `date_created`, `date_updated` y `date_deleted` se
 * coercionan a timestamp). Es la misma razón por la que el listado de ventas no filtra por
 * `date_operation`. Se muestran en la columna de estado y se ordenan por vigencia; filtrarlas exige
 * un cambio en el paginado del backend.
 */
export const PROMOTION_CIRCULATIONS = ['notDiscontinued', 'discontinued'] as const;

export type PromotionCirculation = (typeof PROMOTION_CIRCULATIONS)[number];

/** La clave del `filterConfig` del paginador que resuelve la circulación. */
export const CIRCULATION_FILTER_KEY = 'discontinued';

/**
 * Qué le pide al paginado cada valor del eje. Vacío en «todas», que es la ausencia de filtro.
 *
 * Los dos valores son complementarios exactos —`notDiscontinued` abarca programadas, vigentes y
 * vencidas—, así que entre los dos no queda ninguna fila afuera.
 */
export function circulationFiltersOf(
  circulation: PromotionCirculation | null,
): Record<string, PaginationFilterConstraint> {
  if (circulation === null) {
    return {};
  }

  return {
    [CIRCULATION_FILTER_KEY]: {
      value: circulation === 'discontinued',
      matchMode: FilterMatchMode.Equals,
    },
  };
}

/* ────────────────────────────  Validaciones del ABM  ──────────────────────────── */

/**
 * Las reglas V1 a V7 y V9 del documento funcional, sobre el valor cargado. Son las mismas que
 * `PromotionValidator` del backend, escritas acá para que el usuario las vea antes de guardar y no
 * en la respuesta.
 *
 * **El solapamiento entre promociones no se valida**: «10 % en gaseosas» + «5 % a mayoristas» es un
 * caso de uso legítimo y lo resuelve el motor. El formulario puede advertir, nunca impedir — que es
 * la diferencia con las reglas de precio, donde un producto tiene una sola regla por sucursal.
 *
 * Devuelve las claves de los errores, no mensajes: el texto lo resuelve `validation.*` en el idioma
 * activo. V1 (nombre) no entra acá porque es un `required` de campo, y V8 (las referencias existen y
 * son de la empresa) tampoco: sólo el backend puede contestarla.
 */
export type PromotionIssue =
  | 'percentRange'
  | 'amountPositive'
  | 'nxmQuantities'
  | 'nxmRequiresProducts'
  | 'eligibleSetRequired'
  | 'validFromRequired'
  | 'datesInverted';

export function promotionValidationIssues(value: PromotionFormValue): PromotionIssue[] {
  const issues: PromotionIssue[] = [];

  // V2, V3 y V4: cada tipo con sus propios límites.
  if (value.type === 'PERCENTAGE') {
    const percent = value.percent;
    if (percent == null || percent <= 0 || percent > PERCENT_MAX) {
      issues.push('percentRange');
    }
  }
  if (value.type === 'FIXED_AMOUNT' && (value.amount == null || value.amount <= 0)) {
    issues.push('amountPositive');
  }
  if (value.type === 'NXM') {
    const buy = value.buyQuantity;
    const pay = value.payQuantity;
    if (buy == null || pay == null || pay < 1 || buy <= pay) {
      issues.push('nxmQuantities');
    }
    // V5: el NxM cuenta unidades elegibles, así que no puede pegarle al total de la venta.
    if (value.scope !== 'PRODUCTS') {
      issues.push('nxmRequiresProducts');
    }
  }

  // V6: el ámbito de productos exige a qué productos.
  if (
    value.scope === 'PRODUCTS' &&
    value.productUuids.length === 0 &&
    value.categoryUuids.length === 0
  ) {
    issues.push('eligibleSetRequired');
  }

  // V7: inicio obligatorio; fin, si viene, no anterior al inicio.
  if (!value.validFrom) {
    issues.push('validFromRequired');
  } else if (value.validUntil && value.validUntil < value.validFrom) {
    issues.push('datesInverted');
  }

  return issues;
}

/* ────────────────────────────  Parámetros por tipo  ──────────────────────────── */

/** Los tres pares de parámetros: cada tipo usa los suyos y deja los otros en `null`. */
export interface PromotionTypeParams {
  percent: number | null;
  amount: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
}

/**
 * Los parámetros que le corresponden al tipo, con los de los otros dos en `null`.
 *
 * Escrito **una sola vez** porque de él dependen dos cosas que tienen que coincidir: qué se manda al
 * guardar (V9 — el backend rechaza una NxM que viaje con `percent`) y qué se borra al cambiar de tipo
 * en el formulario. Cuando eran dos ternarios paralelos, que se desincronizaran era una cuestión de
 * tiempo, y el síntoma habría sido un 400 que no nombra al campo que sobra.
 */
export function typeParamsOf(value: PromotionTypeParams & { type: string }): PromotionTypeParams {
  const empty: PromotionTypeParams = {
    percent: null,
    amount: null,
    buyQuantity: null,
    payQuantity: null,
  };

  switch (value.type) {
    case 'PERCENTAGE':
      return { ...empty, percent: value.percent };
    case 'FIXED_AMOUNT':
      return { ...empty, amount: value.amount };
    case 'NXM':
      return { ...empty, buyQuantity: value.buyQuantity, payQuantity: value.payQuantity };
    default:
      return empty;
  }
}

/**
 * Con qué acumulabilidad nace una promoción del tipo elegido. Las NxM nacen **no acumulables** por
 * decisión de negocio (§4.7): una línea con un 3x2 no recibe además un porcentaje. Sigue siendo
 * editable — el default es una sugerencia, no una regla.
 */
export function defaultCombinableFor(type: string): boolean {
  return type !== 'NXM';
}

/* ────────────────────────────  Hidratación  ──────────────────────────── */

/**
 * La promoción guardada como valor del formulario. Lo usan la edición —para poblar la pantalla— y
 * **discontinuar y reactivar desde el listado**, que no son un endpoint propio sino un guardado con
 * `isDiscontinued` invertido.
 *
 * Esa segunda vía es la razón por la que la conversión vive acá y no dentro del formulario: el
 * backend sincroniza las cinco colecciones con lo que recibe, así que guardar sólo el encabezado
 * **desvincularía todo el alcance en silencio**. Discontinuar tiene que reenviar la promoción entera.
 */
export function toPromotionFormValue(promotion: PromotionDto): PromotionFormValue {
  return {
    name: promotion.name ?? '',
    description: promotion.description ?? '',
    type: promotion.type ?? DEFAULT_PROMOTION_TYPE,
    scope: promotion.scope ?? DEFAULT_PROMOTION_SCOPE,
    percent: promotion.percent ?? null,
    amount: promotion.amount ?? null,
    buyQuantity: promotion.buyQuantity ?? null,
    payQuantity: promotion.payQuantity ?? null,
    validFrom: promotion.validFrom ?? '',
    validUntil: promotion.validUntil ?? null,
    isDiscontinued: promotion.isDiscontinued === true,
    // Ausente es acumulable: es el default de la columna.
    isCombinable: promotion.isCombinable !== false,
    productUuids: refUuids(promotion.products),
    categoryUuids: refUuids(promotion.categories),
    customerUuids: refUuids(promotion.customers),
    branchUuids: refUuids(promotion.branches),
    paymentMethodUuids: refUuids(promotion.paymentMethods),
  };
}

function refUuids(refs: readonly UuidNameRef[] | null | undefined): string[] {
  return (refs ?? []).map((ref) => ref.uuid).filter(Boolean);
}

/* ────────────────────────────  Payload  ──────────────────────────── */

/**
 * El body de `/promotion/save` a partir de lo cargado. Los parámetros del tipo elegido van con
 * valor y los de los otros dos en `null` (V9), y las cinco colecciones viajan siempre.
 *
 * @param uuid `undefined` en un alta: es lo único que la distingue de una edición para el backend.
 * @param version la leída al hidratar, para que el backend detecte si alguien más editó en el medio.
 */
export function toPromotionSavePayload(
  value: PromotionFormValue,
  uuid: string | undefined,
  version: number | undefined,
): PromotionSavePayload {
  const description = value.description.trim();

  return {
    ...(uuid ? { uuid, version } : {}),
    name: value.name.trim(),
    description: description || null,
    type: value.type,
    scope: value.scope,
    ...typeParamsOf(value),
    validFrom: value.validFrom,
    validUntil: value.validUntil || null,
    isDiscontinued: value.isDiscontinued,
    isCombinable: value.isCombinable,
    products: toUuidRefs(value.productUuids),
    categories: toUuidRefs(value.categoryUuids),
    customers: toUuidRefs(value.customerUuids),
    branches: toUuidRefs(value.branchUuids),
    paymentMethods: toUuidRefs(value.paymentMethodUuids),
  };
}

function toUuidRefs(uuids: readonly string[]): { uuid: string }[] {
  return uuids.map((uuid) => ({ uuid }));
}

/** El día de una fecha ISO, descartando la hora si viniera. */
function dayOf(date: string | null | undefined): string | null {
  return date ? date.slice(0, 10) : null;
}
