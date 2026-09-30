/**
 * El contrato de `/configuration`: qué claves existen, qué acepta cada una y qué valor rige.
 *
 * La regla que ordena todo esto es que **el backend describe el valor y el front elige el control**.
 * El catálogo dice que algo es un entero con mínimo cero o uno de tres valores; no dice que se
 * dibuje con un campo numérico o con un `mat-select`. Por eso el vocabulario de tipos es cerrado y
 * chico: una clave nueva de un tipo ya conocido no toca ninguna pantalla, y un tipo nuevo obliga a
 * agregar un caso, que es exactamente donde uno quiere que duela.
 *
 * El valor viaja **siempre como string**, que es como el backend lo guarda y lo parsea. El front lo
 * convierte de ida y de vuelta para el control y nada más.
 */

/** Los peldaños de la escalera, del más general al más específico. */
export const CONFIGURATION_SCOPES = ['DEFAULT', 'GLOBAL', 'COMPANY', 'BRANCH', 'USER'] as const;

export type ConfigurationScope = (typeof CONFIGURATION_SCOPES)[number];

/**
 * Los niveles que tienen fila. `DEFAULT` no es uno: es el valor que declara el código del backend y
 * que siempre existe, así que nunca se guarda ni se borra.
 */
export type ConfigurationLevel = Exclude<ConfigurationScope, 'DEFAULT'>;

/** Los seis tipos del contrato. Un séptimo es una decisión explícita de los dos lados. */
export const SETTING_TYPES = [
  'boolean',
  'integer',
  'decimal',
  'string',
  'enum',
  'color',
] as const;

export type SettingType = (typeof SETTING_TYPES)[number];

/** Grupos del catálogo, en el orden en que la pantalla los muestra como solapas. */
export const CONFIGURATION_GROUPS = [
  'general',
  'sale',
  'purchase',
  'stock',
  'cash',
  'ui',
  'system',
] as const;

export type ConfigurationGroup = (typeof CONFIGURATION_GROUPS)[number];

/**
 * Restricciones declarativas del valor. Sólo viajan las que el tipo admite: un `enum` responde
 * `{}`, porque su restricción son sus `possibleValues`.
 *
 * `min` y `max` llegan como texto —el backend los formatea con el mismo tipo que el valor— así que
 * el front los convierte antes de compararlos.
 */
export interface SettingConstraintsDto {
  min?: string | null;
  max?: string | null;
  maxLength?: number | null;
  pattern?: string | null;
  decimals?: number | null;
}

/** Una clave del registro, tal como la publica `GET /configuration/definitions`. */
export interface SettingDefinitionDto {
  key: string;
  group: string;
  type: string;
  constraints?: SettingConstraintsDto | null;
  /** Los valores admitidos. Sólo los declara `enum`; vacío en el resto. */
  possibleValues?: string[] | null;
  /** El valor del nivel `DEFAULT`, ya formateado. `null` es un default válido. */
  defaultValue?: string | null;
  /** Niveles con fila que la clave admite. */
  allowedScopes?: string[] | null;
  visibility?: string | null;
}

/** El valor que rige para una clave en un contexto, y de qué peldaño salió. */
export interface EffectiveSettingDto {
  key: string;
  value: string | null;
  source: ConfigurationScope;
  /**
   * El valor crudo de cada nivel admitido, o `null` donde no hay fila. Sólo llega con
   * `?levels=true`: es lo que necesita el inspector de niveles, no el punto de venta.
   */
  levels?: Partial<Record<ConfigurationLevel, string | null>> | null;
}

/**
 * Un override de ida. Se identifica por **clave natural** (`key` + nivel), así que no lleva `uuid`
 * ni `version`: guardar dos veces la misma clave en el mismo nivel edita la misma fila.
 *
 * `value: null` es «sin configurar»: borra el override y vuelve a regir el nivel de arriba. No es
 * lo mismo que un texto vacío.
 */
export interface SettingSavePayload {
  key: string;
  value: string | null;
  scope: ConfigurationLevel;
  companyUuid?: string;
  branchUuid?: string;
  userUuid?: string;
}

/**
 * Las claves que el front lee **por nombre**, en un solo lugar.
 *
 * La pantalla de configuración no está acá: se dibuja desde el catálogo y no conoce ninguna clave.
 * Esto es para los lectores —el punto de venta, el layout— que sí necesitan una en particular. Un
 * renombre del backend es un solo cambio en este objeto.
 */
export const CONFIGURATION_KEYS = {
  stockValidationPolicy: 'stock.validationPolicy',
  stockExpiredPolicy: 'stock.expiredPolicy',
  stockExpirationAlertDays: 'stock.expirationAlertDays',
  purchaseCostMethod: 'purchase.costMethod',
  scaleBarcodeFormat: 'sale.scaleBarcodeFormat',
  stockAllocationPolicy: 'stock.allocationPolicy',
  menuColor: 'ui.menuColor',
} as const;

/** El tipo declarado, o `string` si el backend publicara uno que este front todavía no conoce. */
export function settingType(definition: SettingDefinitionDto): SettingType {
  return SETTING_TYPES.find((type) => type === definition.type) ?? 'string';
}

/** Los niveles que la clave admite, quedándose sólo con los que el front conoce. */
export function allowedLevels(definition: SettingDefinitionDto): ConfigurationLevel[] {
  return (definition.allowedScopes ?? []).filter(
    (scope): scope is ConfigurationLevel => scope !== 'DEFAULT' && isConfigurationScope(scope),
  );
}

export function allowsLevel(definition: SettingDefinitionDto, level: ConfigurationLevel): boolean {
  return allowedLevels(definition).includes(level);
}

export function isPrivate(definition: SettingDefinitionDto): boolean {
  return definition.visibility === 'PRIVATE';
}

export function isConfigurationScope(value: string): value is ConfigurationScope {
  return CONFIGURATION_SCOPES.some((scope) => scope === value);
}

/**
 * El grupo declarado, o `general` para un grupo que este front no conoce.
 *
 * Cae a un grupo real y no a uno inventado a propósito: una clave nueva de un grupo nuevo tiene que
 * aparecer en alguna solapa aunque el front sea viejo, en vez de desaparecer de la pantalla.
 */
export function settingGroup(definition: SettingDefinitionDto): ConfigurationGroup {
  return CONFIGURATION_GROUPS.find((group) => group === definition.group) ?? 'general';
}

/** El texto que se manda al backend: vacío es «sin configurar», no un valor. */
export function normalizeSettingValue(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}
