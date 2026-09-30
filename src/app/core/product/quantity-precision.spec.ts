import { describe, expect, it } from 'vitest';
import {
  allowsFractionalQuantity,
  clampQuantity,
  isQuantityPrecisionValid,
  minQuantity,
  quantityDecimalsOf,
  quantityStep,
  roundQuantity,
} from './quantity-precision';

/** Las dos mitades del catálogo: `UNIT` es discreta, `KILOGRAM` admite hasta el gramo. */
const DISCRETE = 0;
const KILOGRAM = 3;

describe('quantityDecimalsOf', () => {
  it('reads the precision the product declares', () => {
    expect(quantityDecimalsOf({ unitDecimalPlaces: 0 })).toBe(0);
    expect(quantityDecimalsOf({ unitDecimalPlaces: 3 })).toBe(3);
  });

  /** Sin unidad declarada no hay nada que restringir: es el `NULL` de `products.unit_measure`. */
  it('treats a product with no declared unit as unrestricted', () => {
    expect(quantityDecimalsOf({})).toBeNull();
    expect(quantityDecimalsOf({ unitDecimalPlaces: null })).toBeNull();
    expect(quantityDecimalsOf(null)).toBeNull();
    expect(quantityDecimalsOf(undefined)).toBeNull();
  });

  /** Un valor corrupto no debe convertirse en una restricción inventada. */
  it('discards a precision that is not a non-negative integer', () => {
    expect(quantityDecimalsOf({ unitDecimalPlaces: -1 })).toBeNull();
    expect(quantityDecimalsOf({ unitDecimalPlaces: 1.5 })).toBeNull();
    expect(quantityDecimalsOf({ unitDecimalPlaces: Number.NaN })).toBeNull();
  });

  /**
   * RN-17: con series, la cantidad es cuántos números se informaron, así que es entera aunque la
   * unidad admita decimales. Es el único caso en el que el eje gana sobre la unidad de medida.
   */
  it('forces whole units on a serialised product, whatever its unit allows', () => {
    expect(quantityDecimalsOf({ unitDecimalPlaces: KILOGRAM, stockTracking: 'SERIAL' })).toBe(0);
    expect(quantityDecimalsOf({ stockTracking: 'SERIAL' })).toBe(0);
  });

  /** Los otros tres ejes no dicen nada de la precisión: la sigue declarando la unidad. */
  it('leaves the other tracking modes to the unit', () => {
    expect(quantityDecimalsOf({ unitDecimalPlaces: KILOGRAM, stockTracking: 'BATCH' })).toBe(
      KILOGRAM,
    );
    expect(quantityDecimalsOf({ unitDecimalPlaces: KILOGRAM, stockTracking: 'QUANTITY' })).toBe(
      KILOGRAM,
    );
    expect(quantityDecimalsOf({ stockTracking: 'QUANTITY' })).toBeNull();
  });
});

describe('quantityStep', () => {
  it('steps by one on a discrete unit and by the finest decimal on a divisible one', () => {
    expect(quantityStep(DISCRETE)).toBe(1);
    expect(quantityStep(1)).toBe(0.1);
    expect(quantityStep(2)).toBe(0.01);
    expect(quantityStep(KILOGRAM)).toBe(0.001);
  });

  /** `'any'` es lo que deja escribir cualquier decimal en el input; `step="1"` los rechazaba. */
  it('leaves the step open when the product declares no unit', () => {
    expect(quantityStep(null)).toBe('any');
  });
});

describe('minQuantity', () => {
  it('is one step of the unit', () => {
    expect(minQuantity(DISCRETE)).toBe(1);
    expect(minQuantity(KILOGRAM)).toBe(0.001);
  });

  it('has no declared floor without a unit', () => {
    expect(minQuantity(null)).toBeNull();
  });
});

describe('allowsFractionalQuantity', () => {
  it('separates discrete units from divisible ones', () => {
    expect(allowsFractionalQuantity(DISCRETE)).toBe(false);
    expect(allowsFractionalQuantity(KILOGRAM)).toBe(true);
    expect(allowsFractionalQuantity(null)).toBe(true);
  });
});

describe('roundQuantity', () => {
  it('rounds to the precision of the unit, ties away from zero', () => {
    expect(roundQuantity(1.5, DISCRETE)).toBe(2);
    expect(roundQuantity(1.4, DISCRETE)).toBe(1);
    expect(roundQuantity(0.7555, KILOGRAM)).toBe(0.756);
  });

  it('leaves a quantity that already fits untouched', () => {
    expect(roundQuantity(3, DISCRETE)).toBe(3);
    expect(roundQuantity(0.755, KILOGRAM)).toBe(0.755);
  });

  it('does not touch the quantity of a product with no unit', () => {
    expect(roundQuantity(1.23456, null)).toBe(1.23456);
  });

  /**
   * El caso que obliga a redondear sobre la representación corta: multiplicar por `10 ** n`
   * arrastraría el error binario y bajaría un 0,7 legítimo a 0,69.
   */
  it('rounds on the short decimal representation, not on the binary one', () => {
    expect(roundQuantity(0.1 + 0.6, 2)).toBe(0.7);
    expect(roundQuantity(1.005, 2)).toBe(1.01);
  });
});

describe('isQuantityPrecisionValid', () => {
  it('rejects a fractional quantity on a discrete unit', () => {
    expect(isQuantityPrecisionValid(1.5, DISCRETE)).toBe(false);
    expect(isQuantityPrecisionValid(3, DISCRETE)).toBe(true);
  });

  it('accepts up to the decimals the unit declares and no more', () => {
    expect(isQuantityPrecisionValid(0.755, KILOGRAM)).toBe(true);
    expect(isQuantityPrecisionValid(0.7555, KILOGRAM)).toBe(false);
  });

  /** Un 0,7 que vale 0,6999999999999999 no es un decimal de más. */
  it('absorbs the representation error of the number', () => {
    expect(isQuantityPrecisionValid(0.1 + 0.6, 1)).toBe(true);
    expect(isQuantityPrecisionValid(0.1 + 0.2 + 2.7, DISCRETE)).toBe(true);
  });

  it('restricts nothing when the product declares no unit', () => {
    expect(isQuantityPrecisionValid(1.23456, null)).toBe(true);
  });
});

describe('clampQuantity', () => {
  it('snaps to the unit and never goes below one step', () => {
    expect(clampQuantity(1.5, DISCRETE)).toBe(2);
    expect(clampQuantity(0, DISCRETE)).toBe(1);
    expect(clampQuantity(-4, DISCRETE)).toBe(1);
  });

  /** Lo que el `Math.floor` del carrito hacía imposible: pedir tres cuartos de kilo. */
  it('keeps a fractional quantity on a divisible unit', () => {
    expect(clampQuantity(0.75, KILOGRAM)).toBe(0.75);
    expect(clampQuantity(0.7555, KILOGRAM)).toBe(0.756);
    expect(clampQuantity(0, KILOGRAM)).toBe(0.001);
  });

  /**
   * Sin unidad declarada el decimal pasa igual, pero un cero no puede viajar: el commit lo rechaza.
   * Ese 1 es el reemplazo del cero, no un mínimo que recorte al 0,75.
   */
  it('falls back to one unit only for a non-positive quantity without a unit', () => {
    expect(clampQuantity(0.75, null)).toBe(0.75);
    expect(clampQuantity(0, null)).toBe(1);
    expect(clampQuantity(-2, null)).toBe(1);
  });
});
