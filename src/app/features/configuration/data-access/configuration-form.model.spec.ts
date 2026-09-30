import { describe, expect, it } from 'vitest';
import {
  EffectiveSettingDto,
  SettingDefinitionDto,
} from '../../../core/configuration/configuration.model';
import {
  buildFormState,
  buildSavePayloads,
  inheritedValue,
  validateSetting,
} from './configuration-form.model';

const BRANCH_UUID = 'branch-uuid';
const COMPANY_UUID = 'company-uuid';

const VALIDATION_POLICY: SettingDefinitionDto = {
  key: 'stock.validationPolicy',
  group: 'stock',
  type: 'enum',
  possibleValues: ['STRICT_BLOCK', 'WARNING_CONFIRMATION', 'FORCE_SALE'],
  constraints: {},
  defaultValue: 'STRICT_BLOCK',
  allowedScopes: ['COMPANY', 'BRANCH'],
  visibility: 'PUBLIC',
};

const ALERT_DAYS: SettingDefinitionDto = {
  key: 'stock.expirationAlertDays',
  group: 'stock',
  type: 'integer',
  possibleValues: [],
  constraints: { min: '0' },
  defaultValue: '30',
  allowedScopes: ['COMPANY', 'BRANCH'],
  visibility: 'PUBLIC',
};

const SCALE_FORMAT: SettingDefinitionDto = {
  key: 'sale.scaleBarcodeFormat',
  group: 'sale',
  type: 'string',
  possibleValues: [],
  constraints: { pattern: '^\\d+:\\d+:\\d+:(WEIGHT|AMOUNT)$', maxLength: 32 },
  defaultValue: null,
  allowedScopes: ['COMPANY'],
  visibility: 'PUBLIC',
};

const MENU_COLOR: SettingDefinitionDto = {
  key: 'ui.menuColor',
  group: 'ui',
  type: 'color',
  possibleValues: [],
  constraints: {},
  defaultValue: '#0d2347',
  allowedScopes: ['COMPANY', 'BRANCH'],
  visibility: 'PUBLIC',
};

/** La sucursal Centro pisó la política; el resto lo hereda de su empresa o del default. */
const EFFECTIVE: EffectiveSettingDto[] = [
  {
    key: 'stock.validationPolicy',
    value: 'WARNING_CONFIRMATION',
    source: 'BRANCH',
    levels: { COMPANY: 'FORCE_SALE', BRANCH: 'WARNING_CONFIRMATION', USER: null },
  },
  {
    key: 'stock.expirationAlertDays',
    value: '30',
    source: 'DEFAULT',
    levels: { COMPANY: null, BRANCH: null, USER: null },
  },
  { key: 'sale.scaleBarcodeFormat', value: null, source: 'DEFAULT', levels: { COMPANY: null } },
  { key: 'ui.menuColor', value: '#0d2347', source: 'DEFAULT', levels: { COMPANY: null, BRANCH: null } },
];

const DEFINITIONS = [VALIDATION_POLICY, ALERT_DAYS, SCALE_FORMAT, MENU_COLOR];

function branchState() {
  return buildFormState(DEFINITIONS, EFFECTIVE, () => 'BRANCH');
}

describe('buildFormState', () => {
  /**
   * El campo muestra el valor **efectivo**, no el override propio: un campo vacío porque la empresa
   * lo define no le dice nada a quien mira la pantalla.
   */
  it('shows the effective value of every key', () => {
    const state = branchState();

    expect(state.model['stock.validationPolicy']).toBe('WARNING_CONFIRMATION');
    expect(state.model['stock.expirationAlertDays']).toBe('30');
    expect(state.model['ui.menuColor']).toBe('#0d2347');
  });

  /** Que la fila exista en este nivel es lo que decide si «Restablecer» tiene algo que borrar. */
  it('marks only the keys with a row of their own at that level', () => {
    const state = branchState();

    expect(state.overridden.has('stock.validationPolicy')).toBe(true);
    expect(state.overridden.has('stock.expirationAlertDays')).toBe(false);
  });

  /** Una clave que el nivel no admite nunca cuenta como pisada, aunque llegara un valor. */
  it('never marks a key the level does not allow', () => {
    const state = buildFormState(
      DEFINITIONS,
      [
        {
          key: 'sale.scaleBarcodeFormat',
          value: '2:5:5:WEIGHT',
          source: 'COMPANY',
          levels: { COMPANY: '2:5:5:WEIGHT', BRANCH: '2:5:5:WEIGHT' },
        },
      ],
      () => 'BRANCH',
    );

    expect(state.overridden.has('sale.scaleBarcodeFormat')).toBe(false);
  });

  /** Las de sistema viven en la instancia aunque el selector diga «Sucursal». */
  it('takes the level per key, so a system key stays on the instance', () => {
    const requestLogging: SettingDefinitionDto = {
      key: 'system.requestLogging',
      group: 'system',
      type: 'boolean',
      defaultValue: 'false',
      allowedScopes: ['GLOBAL'],
      visibility: 'PRIVATE',
    };
    const state = buildFormState(
      [requestLogging],
      [{ key: 'system.requestLogging', value: 'true', source: 'GLOBAL', levels: { GLOBAL: 'true' } }],
      (definition) => (definition.group === 'system' ? 'GLOBAL' : 'BRANCH'),
    );

    expect(state.overridden.has('system.requestLogging')).toBe(true);
  });
});

describe('inheritedValue', () => {
  /** Es lo que dice el hint de «Restablecer»: sin eso, restablecer es una apuesta. */
  it('is the first level above that has a row', () => {
    const setting = EFFECTIVE[0];

    expect(inheritedValue(VALIDATION_POLICY, setting, 'BRANCH')).toBe('FORCE_SALE');
  });

  it('falls through to the application default when no level above has one', () => {
    expect(inheritedValue(ALERT_DAYS, EFFECTIVE[1], 'BRANCH')).toBe('30');
    expect(inheritedValue(VALIDATION_POLICY, EFFECTIVE[0], 'COMPANY')).toBe('STRICT_BLOCK');
  });

  it('is the default when nothing was ever read', () => {
    expect(inheritedValue(MENU_COLOR, undefined, 'BRANCH')).toBe('#0d2347');
    expect(inheritedValue(SCALE_FORMAT, undefined, 'COMPANY')).toBeNull();
  });
});

describe('buildSavePayloads', () => {
  const target = { level: 'BRANCH' as const, branchUuid: BRANCH_UUID };

  /**
   * Mandar la solapa entera crearía una fila propia por cada clave que alguien miró sin tocar, y esa
   * sucursal dejaría de heredar de su empresa sin que nadie lo haya decidido.
   */
  it('sends nothing when nothing changed', () => {
    const initial = branchState();

    expect(buildSavePayloads(DEFINITIONS, initial, initial, target)).toEqual([]);
  });

  it('sends the key that was edited, and only that one', () => {
    const initial = branchState();
    const current = {
      ...initial,
      model: { ...initial.model, 'stock.expirationAlertDays': '15' },
      overridden: new Set([...initial.overridden, 'stock.expirationAlertDays']),
    };

    expect(buildSavePayloads(DEFINITIONS, initial, current, target)).toEqual([
      {
        key: 'stock.expirationAlertDays',
        value: '15',
        scope: 'BRANCH',
        branchUuid: BRANCH_UUID,
      },
    ]);
  });

  /** Quitar el override viaja como `value: null`, que es como se vuelve a heredar (RN-05). */
  it('sends a null value for the override that was reset', () => {
    const initial = branchState();
    const overridden = new Set(initial.overridden);
    overridden.delete('stock.validationPolicy');
    const current = {
      ...initial,
      model: { ...initial.model, 'stock.validationPolicy': 'FORCE_SALE' },
      overridden,
    };

    expect(buildSavePayloads(DEFINITIONS, initial, current, target)).toEqual([
      { key: 'stock.validationPolicy', value: null, scope: 'BRANCH', branchUuid: BRANCH_UUID },
    ]);
  });

  /** La clave que el nivel no admite no viaja nunca, aunque el modelo la traiga con valor. */
  it('skips the key that the target level does not allow', () => {
    const initial = branchState();
    const current = {
      ...initial,
      model: { ...initial.model, 'sale.scaleBarcodeFormat': '2:5:5:WEIGHT' },
      overridden: new Set([...initial.overridden, 'sale.scaleBarcodeFormat']),
    };

    expect(buildSavePayloads(DEFINITIONS, initial, current, target)).toEqual([]);
  });

  it('names the owner that matches the level', () => {
    const initial = buildFormState(DEFINITIONS, EFFECTIVE, () => 'COMPANY');
    const current = {
      ...initial,
      model: { ...initial.model, 'ui.menuColor': '#1b5e20' },
      overridden: new Set([...initial.overridden, 'ui.menuColor']),
    };

    expect(
      buildSavePayloads(DEFINITIONS, initial, current, {
        level: 'COMPANY',
        companyUuid: COMPANY_UUID,
      }),
    ).toEqual([
      { key: 'ui.menuColor', value: '#1b5e20', scope: 'COMPANY', companyUuid: COMPANY_UUID },
    ]);
  });
});

describe('validateSetting', () => {
  /** Vacío significa «sin valor», y al guardar se convierte en un reset. */
  it('accepts an empty value for every type', () => {
    expect(validateSetting(ALERT_DAYS, '')).toBeNull();
    expect(validateSetting(VALIDATION_POLICY, null)).toBeNull();
    expect(validateSetting(MENU_COLOR, '   ')).toBeNull();
  });

  it('rejects a value outside the enum', () => {
    expect(validateSetting(VALIDATION_POLICY, 'NO_EXISTE')).toEqual({ kind: 'settingEnumValue' });
    expect(validateSetting(VALIDATION_POLICY, 'FORCE_SALE')).toBeNull();
  });

  /**
   * El rango es parte del tipo y se aplica al escribir. El backend lo vuelve a validar y responde
   * `400 CONFIGURATION_VALUE_INVALID`; esto sólo evita el viaje.
   */
  it('applies the integer bounds that the catalogue declares', () => {
    expect(validateSetting(ALERT_DAYS, '0')).toBeNull();
    expect(validateSetting(ALERT_DAYS, '-1')).toMatchObject({ kind: 'min' });
    expect(validateSetting(ALERT_DAYS, 'dos semanas')).toEqual({ kind: 'integer' });
    expect(validateSetting(ALERT_DAYS, '1.5')).toEqual({ kind: 'integer' });
  });

  it('applies the pattern and the length of a string', () => {
    expect(validateSetting(SCALE_FORMAT, '2:5:5:WEIGHT')).toBeNull();
    expect(validateSetting(SCALE_FORMAT, '2:5:WEIGHT')).toEqual({ kind: 'settingPattern' });
    expect(validateSetting({ ...SCALE_FORMAT, constraints: { maxLength: 4 } }, 'abcde')).toMatchObject(
      { kind: 'maxLength' },
    );
  });

  it('demands six hex digits from a colour', () => {
    expect(validateSetting(MENU_COLOR, '#0d2347')).toBeNull();
    expect(validateSetting(MENU_COLOR, 'azul')).toEqual({ kind: 'settingColor' });
    expect(validateSetting(MENU_COLOR, '#0d234')).toEqual({ kind: 'settingColor' });
  });

  /**
   * Un tipo que este front todavía no conoce se trata como texto en vez de rechazarse: una clave
   * nueva del backend no debería romper la pantalla.
   */
  it('treats an unknown type as free text', () => {
    const exotic: SettingDefinitionDto = { ...MENU_COLOR, type: 'duration' };

    expect(validateSetting(exotic, 'lo que sea')).toBeNull();
  });
});
