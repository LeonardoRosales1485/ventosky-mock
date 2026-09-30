import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCALE_FORMAT,
  formatScaleFormat,
  isCompleteScaleFormat,
  padScaleSample,
  parseScaleFormat,
  scaleCodeLengthOf,
} from './scale-format.model';

describe('parseScaleFormat', () => {
  /** El ejemplo del documento funcional: `2 00123 01250 7`. */
  it('splits the stored text into its four parts', () => {
    expect(parseScaleFormat('2:5:5:WEIGHT')).toEqual({
      prefix: '2',
      codeLength: '5',
      valueLength: '5',
      valueType: 'WEIGHT',
    });
  });

  it('accepts the value type in any case', () => {
    expect(parseScaleFormat('2:5:5:amount').valueType).toBe('AMOUNT');
  });

  /**
   * Un texto que no se entiende cae a vacío en vez de fallar: es lo mismo que hace el punto de venta
   * al leerlo, y acá además deja los campos listos para escribirlo bien.
   */
  it('falls back to empty for anything it cannot read', () => {
    expect(parseScaleFormat(null)).toEqual(EMPTY_SCALE_FORMAT);
    expect(parseScaleFormat('')).toEqual(EMPTY_SCALE_FORMAT);
    expect(parseScaleFormat('2:5:WEIGHT')).toEqual(EMPTY_SCALE_FORMAT);
  });
});

describe('isCompleteScaleFormat', () => {
  it('is true only when the four parts can read a label', () => {
    expect(isCompleteScaleFormat(parseScaleFormat('2:5:5:WEIGHT'))).toBe(true);
  });

  /** Respeta la forma del texto y no desarma nada: un largo en cero no recorta ningún tramo. */
  it('is false for a length of zero', () => {
    expect(isCompleteScaleFormat(parseScaleFormat('2:0:5:WEIGHT'))).toBe(false);
  });

  it('is false while a part is still missing', () => {
    expect(isCompleteScaleFormat({ ...parseScaleFormat('2:5:5:WEIGHT'), prefix: '' })).toBe(false);
  });
});

describe('formatScaleFormat', () => {
  it('round-trips through the parser', () => {
    expect(formatScaleFormat(parseScaleFormat(' 2:5:5:weight '))).toBe('2:5:5:WEIGHT');
  });
});

describe('padScaleSample', () => {
  /** El ejemplo tiene que ocupar exactamente el largo configurado, o el desarme miente. */
  it('pads and trims the sample to the configured length', () => {
    expect(padScaleSample('00123', 5)).toBe('00123');
    expect(padScaleSample('00123', 7)).toBe('0000123');
    expect(padScaleSample('00123', 3)).toBe('123');
    expect(padScaleSample('00123', 0)).toBe('');
  });
});

describe('scaleCodeLengthOf', () => {
  it('reads the length of the product code from the stored text', () => {
    expect(scaleCodeLengthOf('2:5:5:WEIGHT')).toBe(5);
    expect(scaleCodeLengthOf(' 20:4:6:AMOUNT ')).toBe(4);
  });

  /**
   * `null` es «no hay largo que exigir». La ficha de producto se apoya en esa distinción: sin
   * formato utilizable no valida el largo del código en vez de inventar uno.
   */
  it('is null when the text does not declare a usable format', () => {
    expect(scaleCodeLengthOf(null)).toBeNull();
    expect(scaleCodeLengthOf('')).toBeNull();
    expect(scaleCodeLengthOf('2:5:WEIGHT')).toBeNull();
    expect(scaleCodeLengthOf('2:0:5:WEIGHT')).toBeNull();
    expect(scaleCodeLengthOf(':5:5:WEIGHT')).toBeNull();
  });
});
