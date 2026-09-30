import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_ROUNDING } from './price-rounding';
import { computeLineAmounts, sumTotals } from './order-pricing';

/** Cómo cierra la línea de un producto sin regla con un comprobante que suma el impuesto. */
const line = (unitPrice: number, quantity: number, taxRate: number) =>
  computeLineAmounts(unitPrice, quantity, taxRate, DEFAULT_PRICE_ROUNDING, true);

describe('computeLineAmounts', () => {
  it('adds the tax on top of the net amount', () => {
    const amounts = line(45000, 1, 21);

    expect(amounts.unitPrice).toBe(45000);
    expect(amounts.netAmount).toBe(45000);
    expect(amounts.taxAmount).toBe(9450);
    expect(amounts.subtotal).toBe(54450);
  });

  it('multiplies by the quantity before taxing', () => {
    const amounts = line(5000, 2, 21);

    expect(amounts.netAmount).toBe(10000);
    expect(amounts.taxAmount).toBe(2100);
    expect(amounts.subtotal).toBe(12100);
  });

  /**
   * El backend redondea el precio unitario **antes** de multiplicar. Redondear el total en su lugar
   * daría otro número en cuanto la cantidad sea mayor a uno, y la pantalla mostraría un total que
   * el comprobante no confirma.
   */
  it('rounds the unit price before multiplying, like the backend does', () => {
    const amounts = line(10.005, 100, 0);

    expect(amounts.unitPrice).toBe(10.01);
    expect(amounts.netAmount).toBe(1001);
  });

  it('leaves the subtotal equal to the net amount when the product has no tax', () => {
    const amounts = line(1000, 3, 0);

    expect(amounts.taxAmount).toBe(0);
    expect(amounts.subtotal).toBe(3000);
  });

  /**
   * `adds_tax = false` (factura B o C): se cobra el importe de la lista sin agregar nada. No es lo
   * mismo que un producto exento — la alícuota sigue existiendo, sólo que no se aplica.
   */
  it('ignores the tax rate when the voucher adds no tax', () => {
    const amounts = computeLineAmounts(1000, 3, 21, DEFAULT_PRICE_ROUNDING, false);

    expect(amounts.taxAmount).toBe(0);
    expect(amounts.subtotal).toBe(3000);
  });

  /** El redondeo entra en las tres cuentas: unitario, impuesto y subtotal. */
  it('applies the rounding the rule declares to every amount', () => {
    const amounts = computeLineAmounts(1234, 1, 21, { mode: 'MULTIPLE_10', direction: 'UP' }, true);

    expect(amounts.unitPrice).toBe(1240);
    expect(amounts.taxAmount).toBe(270);
    expect(amounts.subtotal).toBe(1510);
  });
});

describe('sumTotals', () => {
  it('adds up the lines of the sale in the mockup', () => {
    const totals = sumTotals([line(45000, 1, 21), line(5000, 2, 21)]);

    expect(totals.netAmount).toBe(55000);
    expect(totals.taxAmount).toBe(11550);
    expect(totals.totalAmount).toBe(66550);
  });

  it('is all zeros for an empty cart', () => {
    expect(sumTotals([])).toEqual({
      netAmount: 0,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
    });
  });
});
