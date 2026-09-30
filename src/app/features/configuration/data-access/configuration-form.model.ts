import {
  ConfigurationLevel,
  EffectiveSettingDto,
  SettingDefinitionDto,
  SettingSavePayload,
  allowsLevel,
  normalizeSettingValue,
  settingType,
} from '../../../core/configuration/configuration.model';

/**
 * Nada de este archivo importa Angular, a propósito: es lo único que la suite de este repo corre en
 * verde —los specs con `TestBed` fallan de base—, y la conversión de estos errores a los de Signal
 * Forms vive al lado, en `configuration-form.schema.ts`.
 */

/**
 * Por qué un valor no sirve. `kind` es la clave de i18n (`validation.<kind>`), y los tres con
 * argumento son los que Signal Forms ya sabe redactar con el límite adentro.
 */
export type SettingValidationError =
  | {
      kind:
        | 'settingBoolean'
        | 'settingEnumValue'
        | 'settingColor'
        | 'settingPattern'
        | 'settingDecimals'
        | 'integer'
        | 'parse';
    }
  | { kind: 'min'; min: number }
  | { kind: 'max'; max: number }
  | { kind: 'maxLength'; maxLength: number };

/**
 * El modelo del formulario: el valor **mostrado** de cada clave, siempre como texto.
 *
 * Es el valor efectivo y no el override propio a propósito. Un campo vacío porque el nivel de
 * arriba lo define no le dice nada a quien mira la pantalla: lo que necesita ver es qué está
 * rigiendo hoy, y aparte, en el chip, de dónde salió. Que la fila exista o no en este nivel se
 * lleva por separado, en {@link SettingsFormState.overridden}.
 */
export type SettingsFormModel = Record<string, string | null>;

/** Lo que la pantalla necesita saber de una clave, más allá de su valor. */
export interface SettingsFormState {
  /** Valor mostrado y editable de cada clave. Es lo que envuelve Signal Forms. */
  model: SettingsFormModel;
  /** Claves con fila **propia** en el nivel que se está editando. */
  overridden: ReadonlySet<string>;
  /**
   * Qué regiría en cada clave si este nivel no tuviera fila: el nivel de arriba que sí la tenga, o
   * el valor por defecto de la aplicación. Es lo que dice el hint de «Restablecer» — sin eso,
   * restablecer es una apuesta.
   */
  inherited: SettingsFormModel;
}

/**
 * Prioridad de los peldaños, del más específico al más general. `DEFAULT` no está: no es una fila,
 * es el valor que declara el registro del backend y con el que termina toda cadena.
 */
const LEVELS_BY_PRIORITY: readonly ConfigurationLevel[] = ['USER', 'BRANCH', 'COMPANY', 'GLOBAL'];

/**
 * Arma el estado inicial del formulario a partir del catálogo y de
 * `/configuration/effective?levels=true`.
 *
 * El nivel se pide **por clave** y no de una vez: las claves de sistema viven en el nivel de
 * instancia y las de negocio en el que eligió el selector, y las dos se dibujan en la misma
 * pantalla.
 *
 * Una clave que el nivel no admite entra igual, en modo lectura: la pantalla la muestra
 * deshabilitada con el motivo, en vez de esconderla y dejar a quien la busca preguntándose dónde
 * está.
 */
export function buildFormState(
  definitions: readonly SettingDefinitionDto[],
  effective: readonly EffectiveSettingDto[],
  levelOf: (definition: SettingDefinitionDto) => ConfigurationLevel,
): SettingsFormState {
  const byKey = new Map(effective.map((setting) => [setting.key, setting]));
  const model: SettingsFormModel = {};
  const inherited: SettingsFormModel = {};
  const overridden = new Set<string>();

  for (const definition of definitions) {
    const setting = byKey.get(definition.key);
    const level = levelOf(definition);
    const own = setting?.levels?.[level] ?? null;

    model[definition.key] = setting?.value ?? definition.defaultValue ?? null;
    inherited[definition.key] = inheritedValue(definition, setting, level);

    if (own !== null && allowsLevel(definition, level)) {
      overridden.add(definition.key);
    }
  }

  return { model, overridden, inherited };
}

/**
 * Qué regiría en esta clave si el nivel que se edita no tuviera fila: el peldaño de más arriba que
 * sí la tenga, y si ninguno la tiene, el valor por defecto de la aplicación.
 */
export function inheritedValue(
  definition: SettingDefinitionDto,
  setting: EffectiveSettingDto | undefined,
  level: ConfigurationLevel,
): string | null {
  const levels = setting?.levels ?? {};
  const below = LEVELS_BY_PRIORITY.slice(LEVELS_BY_PRIORITY.indexOf(level) + 1);

  for (const candidate of below) {
    const value = levels[candidate] ?? null;
    if (value !== null) {
      return value;
    }
  }

  return definition.defaultValue ?? null;
}

/**
 * Los overrides a escribir: sólo las claves que cambiaron de verdad respecto de cómo se abrió la
 * pantalla.
 *
 * Mandar la solapa entera parece más simple y no lo es: crearía una fila en este nivel por cada
 * clave que alguien miró sin tocar, y a partir de ahí esa sucursal dejaría de heredar de su empresa
 * sin que nadie lo haya decidido.
 *
 * Una clave que dejó de estar pisada viaja con `value: null`, que es como se borra el override y se
 * vuelve a heredar.
 */
export function buildSavePayloads(
  definitions: readonly SettingDefinitionDto[],
  initial: SettingsFormState,
  current: SettingsFormState,
  target: { level: ConfigurationLevel; companyUuid?: string; branchUuid?: string; userUuid?: string },
): SettingSavePayload[] {
  const payloads: SettingSavePayload[] = [];

  for (const definition of definitions) {
    if (!allowsLevel(definition, target.level)) {
      continue;
    }

    const key = definition.key;
    const wasOverridden = initial.overridden.has(key);
    const isOverridden = current.overridden.has(key);
    const value = normalizeSettingValue(current.model[key]);

    if (!isOverridden) {
      if (wasOverridden) {
        payloads.push({ key, value: null, scope: target.level, ...owner(target) });
      }
      continue;
    }

    if (!wasOverridden || value !== normalizeSettingValue(initial.model[key])) {
      payloads.push({ key, value, scope: target.level, ...owner(target) });
    }
  }

  return payloads;
}

function owner(target: {
  companyUuid?: string;
  branchUuid?: string;
  userUuid?: string;
}): Pick<SettingSavePayload, 'companyUuid' | 'branchUuid' | 'userUuid'> {
  if (target.branchUuid) {
    return { branchUuid: target.branchUuid };
  }
  if (target.userUuid) {
    return { userUuid: target.userUuid };
  }
  return target.companyUuid ? { companyUuid: target.companyUuid } : {};
}

/**
 * Valida un valor con el `type` y las `constraints` que declara el catálogo — las mismas reglas que
 * el backend aplica en `parse`.
 *
 * El backend sigue siendo la autoridad: esto no lo reemplaza, le evita el viaje a lo que ya se sabe
 * que va a rechazar. Un `400 CONFIGURATION_VALUE_INVALID` que llegue igual se marca sobre el campo.
 *
 * Vacío es siempre válido: significa «sin valor», y al guardar se convierte en un reset.
 */
export function validateSetting(
  definition: SettingDefinitionDto,
  raw: string | null,
): SettingValidationError | null {
  const value = normalizeSettingValue(raw);
  if (value === null) {
    return null;
  }

  const constraints = definition.constraints ?? {};

  switch (settingType(definition)) {
    case 'boolean':
      return value === 'true' || value === 'false' ? null : { kind: 'settingBoolean' };

    case 'enum':
      return (definition.possibleValues ?? []).includes(value)
        ? null
        : { kind: 'settingEnumValue' };

    case 'color':
      return /^#[0-9a-fA-F]{6}$/.test(value) ? null : { kind: 'settingColor' };

    case 'integer': {
      if (!/^-?\d+$/.test(value)) {
        return { kind: 'integer' };
      }
      return checkRange(Number(value), constraints.min, constraints.max);
    }

    case 'decimal': {
      if (!/^-?\d+(\.\d+)?$/.test(value)) {
        return { kind: 'parse' };
      }
      const decimals = constraints.decimals;
      if (decimals != null && (value.split('.')[1]?.length ?? 0) > decimals) {
        return { kind: 'settingDecimals' };
      }
      return checkRange(Number(value), constraints.min, constraints.max);
    }

    default: {
      const maxLength = constraints.maxLength;
      if (maxLength != null && value.length > maxLength) {
        return { kind: 'maxLength', maxLength };
      }
      if (constraints.pattern && !new RegExp(constraints.pattern).test(value)) {
        return { kind: 'settingPattern' };
      }
      return null;
    }
  }
}

function checkRange(
  value: number,
  min: string | null | undefined,
  max: string | null | undefined,
): SettingValidationError | null {
  // El límite viaja adentro del error para que el mensaje lo diga: «el mínimo es 0» y no «valor
  // inválido». Es el mismo argumento que ya lee `field-error.pipe`.
  if (min != null && min !== '' && value < Number(min)) {
    return { kind: 'min', min: Number(min) };
  }
  if (max != null && max !== '' && value > Number(max)) {
    return { kind: 'max', max: Number(max) };
  }
  return null;
}

// ==================== Codecs control ↔ texto ====================
//
// El valor viaja siempre como string, que es lo que el backend guarda y parsea. Estas dos funciones
// son toda la conversión que hace falta: el resto de los controles trabajan con el texto tal cual.

export function toBooleanValue(raw: string | null): boolean {
  return raw === 'true';
}

export function fromBooleanValue(checked: boolean): string {
  return checked ? 'true' : 'false';
}
