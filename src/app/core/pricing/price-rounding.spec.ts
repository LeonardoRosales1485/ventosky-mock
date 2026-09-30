import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICE_ROUNDING,
  PriceRoundingDirection,
  PriceRoundingMode,
  roundAmount,
  toPriceRounding,
} from './price-rounding';

const round = (value: number, mode: PriceRoundingMode, direction: PriceRoundingDirection) =>
  roundAmount(value, { mode, direction });

describe('roundAmount', () => {
  /** La misma tabla que documenta `PriceRoundingMode` del backend, fila por fila. */
  it('closes 40.56 where each mode and direction say it should', () => {
    expect(round(40.56, 'TWO_DECIMALS', 'UP')).toBe(40.56);
    expect(round(40.56, 'TWO_DECIMALS', 'DOWN')).toBe(40.56);
    expect(round(40.56, 'TWO_DECIMALS', 'NEAREST')).toBe(40.56);

    expect(round(40.56, 'ONE_DECIMAL', 'UP')).toBe(40.6);
    expect(round(40.56, 'ONE_DECIMAL', 'DOWN')).toBe(40.5);
    expect(round(40.56, 'ONE_DECIMAL', 'NEAREST')).toBe(40.6);

    expect(round(40.56, 'ZERO_DECIMALS', 'UP')).toBe(41);
    expect(round(40.56, 'ZERO_DECIMALS', 'DOWN')).toBe(40);
    expect(round(40.56, 'ZERO_DECIMALS', 'NEAREST')).toBe(41);

    expect(round(40.56, 'MULTIPLE_10', 'UP')).toBe(50);
    expect(round(40.56, 'MULTIPLE_10', 'DOWN')).toBe(40);
    expect(round(40.56, 'MULTIPLE_10', 'NEAREST')).toBe(40);

    expect(round(40.56, 'MULTIPLE_100', 'UP')).toBe(100);
    expect(round(40.56, 'MULTIPLE_100', 'DOWN')).toBe(0);
    expect(round(40.56, 'MULTIPLE_100', 'NEAREST')).toBe(0);
  });

  /** `NEAREST` es `HALF_UP`: el empate se va para arriba, no al par más cercano. */
  it('breaks a tie upwards', () => {
    expect(round(40.5, 'ZERO_DECIMALS', 'NEAREST')).toBe(41);
    expect(round(40.4, 'ZERO_DECIMALS', 'NEAREST')).toBe(40);
    expect(round(45, 'MULTIPLE_10', 'NEAREST')).toBe(50);
  });

  it('leaves an amount that already matches the mode untouched', () => {
    expect(round(1230, 'MULTIPLE_10', 'UP')).toBe(1230);
    expect(round(1200, 'MULTIPLE_100', 'UP')).toBe(1200);
    expect(round(40.5, 'ONE_DECIMAL', 'UP')).toBe(40.5);
  });

  /**
   * El caso que obliga a redondear sobre la representación decimal corta y no con `× 10 ** n`: en
   * coma flotante `198.6 * 10` da 1986.0000000000002, y `UP` lo subiría a 198.61.
   */
  it('does not let floating point drag an exact amount upwards', () => {
    expect(round(198.6, 'ONE_DECIMAL', 'UP')).toBe(198.6);
    expect(round(8.22, 'TWO_DECIMALS', 'UP')).toBe(8.22);
    expect(round(1.005, 'TWO_DECIMALS', 'UP')).toBe(1.01);
  });

  it('applies the defaults of a product no rule reaches', () => {
    expect(roundAmount(1234.567, DEFAULT_PRICE_ROUNDING)).toBe(1234.57);
  });
});

describe('toPriceRounding', () => {
  it('reads what the rule declares', () => {
    expect(toPriceRounding('MULTIPLE_10', 'UP')).toEqual({
      mode: 'MULTIPLE_10',
      direction: 'UP',
    });
  });

  /** Los dos campos son opcionales en el backend y cada uno cae a su propio default. */
  it('falls back to the default of each half on its own', () => {
    expect(toPriceRounding(null, 'DOWN')).toEqual({ mode: 'TWO_DECIMALS', direction: 'DOWN' });
    expect(toPriceRounding('ZERO_DECIMALS', undefined)).toEqual({
      mode: 'ZERO_DECIMALS',
      direction: 'NEAREST',
    });
    expect(toPriceRounding('LO_QUE_SEA', 'TAMPOCO')).toEqual(DEFAULT_PRICE_ROUNDING);
  });
});
