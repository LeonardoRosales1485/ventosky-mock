import { describe, expect, it } from 'vitest';
import {
  SettingDefinitionDto,
  allowedLevels,
  allowsLevel,
  isPrivate,
  normalizeSettingValue,
  settingGroup,
  settingType,
} from './configuration.model';

function definition(patch: Partial<SettingDefinitionDto> = {}): SettingDefinitionDto {
  return {
    key: 'stock.validationPolicy',
    group: 'stock',
    type: 'enum',
    possibleValues: ['STRICT_BLOCK'],
    constraints: {},
    defaultValue: 'STRICT_BLOCK',
    allowedScopes: ['COMPANY', 'BRANCH'],
    visibility: 'PUBLIC',
    ...patch,
  };
}

describe('settingType', () => {
  it('takes the type the catalogue declares', () => {
    expect(settingType(definition({ type: 'integer' }))).toBe('integer');
    expect(settingType(definition({ type: 'color' }))).toBe('color');
  });

  /**
   * Un tipo que este front no conoce cae a texto en vez de romper la pantalla: el vocabulario es
   * cerrado y chico justamente para que agregarle uno sea una decisión de los dos lados, pero
   * mientras tanto la clave tiene que poder verse y editarse.
   */
  it('falls back to free text for a type it does not know', () => {
    expect(settingType(definition({ type: 'duration' }))).toBe('string');
  });
});

describe('settingGroup', () => {
  it('takes the group the catalogue declares', () => {
    expect(settingGroup(definition({ group: 'cash' }))).toBe('cash');
  });

  /** Una clave de un grupo nuevo tiene que aparecer en alguna solapa, no desaparecer. */
  it('falls back to a real tab for a group it does not know', () => {
    expect(settingGroup(definition({ group: 'billing' }))).toBe('general');
  });
});

describe('allowedLevels', () => {
  it('keeps only the levels it understands', () => {
    expect(allowedLevels(definition({ allowedScopes: ['COMPANY', 'BRANCH', 'TENANT'] }))).toEqual([
      'COMPANY',
      'BRANCH',
    ]);
  });

  /** `DEFAULT` no es un nivel con fila: es el valor del código y no se guarda ni se borra. */
  it('never counts DEFAULT as a level', () => {
    expect(allowedLevels(definition({ allowedScopes: ['DEFAULT', 'COMPANY'] }))).toEqual(['COMPANY']);
  });

  it('answers whether a level is allowed', () => {
    const scaleFormat = definition({ allowedScopes: ['COMPANY'] });

    expect(allowsLevel(scaleFormat, 'COMPANY')).toBe(true);
    expect(allowsLevel(scaleFormat, 'BRANCH')).toBe(false);
  });
});

describe('isPrivate', () => {
  it('is true only for the keys the backend marks private', () => {
    expect(isPrivate(definition({ visibility: 'PRIVATE' }))).toBe(true);
    expect(isPrivate(definition())).toBe(false);
  });
});

describe('normalizeSettingValue', () => {
  /** Vacío es «sin configurar», que al guardar se convierte en un reset; no es un valor. */
  it('turns anything blank into null', () => {
    expect(normalizeSettingValue('')).toBeNull();
    expect(normalizeSettingValue('   ')).toBeNull();
    expect(normalizeSettingValue(null)).toBeNull();
    expect(normalizeSettingValue(undefined)).toBeNull();
  });

  it('trims what it keeps', () => {
    expect(normalizeSettingValue('  2:5:5:WEIGHT ')).toBe('2:5:5:WEIGHT');
  });
});
