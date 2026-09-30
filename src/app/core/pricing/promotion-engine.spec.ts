import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_ROUNDING } from './price-rounding';
import { computeLineAmounts, sumTotals } from './order-pricing';
import { PromotionLineResult, withPromotionDiscount } from './promotion-engine';

/**
 * La aritmética del motor se prueba con los fixtures compartidos, que corren también del lado Java
 * (`promotion-engine-fixtures.spec.ts`). Acá queda lo que es sólo de este lado: cómo el resultado
 * del motor entra al checkout.
 */

const result = (over: Partial<PromotionLineResult> = {}): PromotionLineResult => ({
  index: 0,
  factor: 0.9,
  discountAmount: 100,
  net: 900,
  taxAmount: 189,
  subtotal: 1089,
  ...over,
});

describe('withPromotionDiscount', () => {
  /**
   * El subtotal de la línea viaja **ya neto**: es el que suma el checkout y contra el que después
   * tienen que cerrar los pagos.
   */
  it('replaces the list amounts with the discounted ones', () => {
    const amounts = withPromotionDiscount(
      computeLineAmounts(1000, 1, 21, DEFAULT_PRICE_ROUNDING, true),
      result(),
    );

    expect(amounts.discountAmount).toBe(100);
    expect(amounts.netAmount).toBe(900);
    expect(amounts.taxAmount).toBe(189);
    expect(amounts.subtotal).toBe(1089);
  });

  /** El precio unitario es el de lista y ninguna promoción lo toca: lo que baja es el neto. */
  it('keeps the list unit price', () => {
    const amounts = withPromotionDiscount(
      computeLineAmounts(1000, 1, 21, DEFAULT_PRICE_ROUNDING, true),
      result(),
    );

    expect(amounts.unitPrice).toBe(1000);
  });
});

describe('sumTotals with discounted lines', () => {
  it('adds up what the promotions took off the lines', () => {
    const untouched = computeLineAmounts(500, 1, 21, DEFAULT_PRICE_ROUNDING, true);
    const discounted = withPromotionDiscount(
      computeLineAmounts(1000, 1, 21, DEFAULT_PRICE_ROUNDING, true),
      result(),
    );

    const totals = sumTotals([untouched, discounted]);

    expect(totals.discountAmount).toBe(100);
    expect(totals.netAmount).toBe(1400);
    expect(totals.taxAmount).toBe(294);
    expect(totals.totalAmount).toBe(1694);
  });

  /** Una línea que ninguna promoción alcanza no inventa un descuento de cero pesos. */
  it('leaves the discount at zero when no promotion reached a line', () => {
    const totals = sumTotals([computeLineAmounts(1000, 2, 21, DEFAULT_PRICE_ROUNDING, true)]);

    expect(totals.discountAmount).toBe(0);
  });
});
