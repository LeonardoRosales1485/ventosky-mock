import { describe, expect, it } from 'vitest';
import { divide, round2, scaled } from './decimals';

/**
 * Lo que este módulo tiene que garantizar es una sola cosa: que la cuenta dé lo mismo que el
 * `BigDecimal` del backend. Los casos de acá son los que un `number` pelado se equivoca.
 */
describe('round2', () => {
  it('rounds the tie away from zero, like HALF_UP', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
  });

  /**
   * 1,15 se guarda como 1,149999999999999911…, así que redondear sobre la representación binaria lo
   * bajaría a 1,14. La coma se corre sobre la representación decimal corta justamente por esto.
   */
  it('rounds what the user sees, not the binary representation', () => {
    expect(round2(1.145)).toBe(1.15);
    expect(round2(329.9967)).toBe(330);
  });
});

describe('scaled', () => {
  /** El caso de siempre: sumar o restar dos importes exactos deja basura que el paso siguiente arrastra. */
  it('clears the dust that adding two exact amounts leaves behind', () => {
    expect(1000.1 + 0.2).not.toBe(1000.3);
    expect(scaled(1000.1 + 0.2)).toBe(1000.3);

    expect(1234.56 - 7.89).not.toBe(1226.67);
    expect(scaled(1234.56 - 7.89)).toBe(1226.67);
  });

  it('leaves a value that already fits the working scale untouched', () => {
    expect(scaled(0.123456)).toBe(0.123456);
  });
});

describe('divide', () => {
  it('divides with the working scale, rounding half up', () => {
    expect(divide(1, 3)).toBe(0.333333);
    expect(divide(2, 3)).toBe(0.666667);
  });

  /** Quien divide por una cantidad o por un total que puede ser cero quería ese mismo cero. */
  it('is zero instead of infinity when the divisor is zero', () => {
    expect(divide(100, 0)).toBe(0);
  });
});
