import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_ROUNDING } from '../../../core/pricing/price-rounding';
import {
  SaleCartLine,
  SaleProductDto,
  addsTax,
  decrementsStock,
  isSaleVoucher,
  resolveUnitPrice,
  toCartLineView,
} from './sale.model';

const PRINCIPAL = 'principal-uuid';
const WHOLESALE = 'wholesale-uuid';

function product(entries: { priceListUuid: string; price: number | null }[]): SaleProductDto {
  return { uuid: 'product-uuid', name: 'Zapatillas', priceListEntries: entries };
}

describe('resolveUnitPrice', () => {
  it('takes the price of the customer preferred list', () => {
    const resolved = resolveUnitPrice(
      product([
        { priceListUuid: PRINCIPAL, price: 45000 },
        { priceListUuid: WHOLESALE, price: 38000 },
      ]),
      WHOLESALE,
    );

    expect(resolved).toEqual({ unitPrice: 38000, priceListUuid: WHOLESALE });
  });

  /**
   * La caída a la lista principal se eliminó en la `v83`: el backend responde 400 en el checkout
   * cuando el producto no tiene precio en la lista del cliente, así que simularla acá mostraría un
   * precio con el que la venta no cierra.
   */
  it('never falls back to the principal list', () => {
    const entries = [{ priceListUuid: PRINCIPAL, price: 45000 }];

    expect(resolveUnitPrice(product(entries), WHOLESALE)).toBeNull();
  });

  it('returns null when the list has no price', () => {
    expect(resolveUnitPrice(product([]), WHOLESALE)).toBeNull();
  });

  /** Un precio ausente no es cero: la entrada existe pero el producto no tiene precio en la lista. */
  it('treats a null price as no price at all', () => {
    const resolved = resolveUnitPrice(
      product([
        { priceListUuid: WHOLESALE, price: null },
        { priceListUuid: PRINCIPAL, price: 45000 },
      ]),
      WHOLESALE,
    );

    expect(resolved).toBeNull();
  });

  it('accepts a zero price that the company configured on purpose', () => {
    const resolved = resolveUnitPrice(product([{ priceListUuid: WHOLESALE, price: 0 }]), WHOLESALE);

    expect(resolved).toEqual({ unitPrice: 0, priceListUuid: WHOLESALE });
  });

  it('returns null when there is no list to resolve with', () => {
    expect(resolveUnitPrice(product([{ priceListUuid: PRINCIPAL, price: 45000 }]), null)).toBeNull();
  });
});

describe('decrementsStock', () => {
  it('is true for a voucher that takes goods out of the branch', () => {
    expect(
      decrementsStock({
        uuid: 'sale-invoice',
        name: 'Factura B (venta)',
        stockEffect: 'DECREMENT',
        balanceEffect: 'INCREMENT',
      }),
    ).toBe(true);
  });

  /** Una orden de venta o un presupuesto no tocan el inventario: el backend ni lo mira. */
  it('is false for a voucher with no stock effect', () => {
    expect(
      decrementsStock({
        uuid: 'sale-order',
        name: 'Orden de venta',
        stockEffect: 'NONE',
        balanceEffect: 'NONE',
      }),
    ).toBe(false);
  });

  it('is false without a voucher chosen', () => {
    expect(decrementsStock(null)).toBe(false);
  });
});

describe('isSaleVoucher', () => {
  /**
   * El sentido lo declara el comprobante y no se deduce de los efectos: una nota de crédito de venta
   * resta plata (`DECREMENT` de balance) y sigue siendo una venta.
   */
  it('reads the operation the voucher declares, not its effects', () => {
    expect(
      isSaleVoucher({
        uuid: 'sale-credit-note',
        name: 'Nota de crédito A (venta)',
        operationType: 'SALE',
        stockEffect: 'INCREMENT',
        balanceEffect: 'DECREMENT',
      }),
    ).toBe(true);

    expect(
      isSaleVoucher({
        uuid: 'purchase-credit-note',
        name: 'Nota de crédito (compra)',
        operationType: 'PURCHASE',
        stockEffect: 'DECREMENT',
        balanceEffect: 'INCREMENT',
      }),
    ).toBe(false);
  });
});

describe('addsTax', () => {
  it('is off only when the voucher says so', () => {
    const voucher = { uuid: 'v', name: 'Factura', operationType: 'SALE' } as const;

    expect(addsTax({ ...voucher, addsTax: false })).toBe(false);
    expect(addsTax({ ...voucher, addsTax: true })).toBe(true);
  });

  /** El default de la columna es `true`, que es como venía calculando el commit antes de `v73`. */
  it('adds the tax when the voucher does not declare it', () => {
    expect(addsTax({ uuid: 'v', name: 'Factura', operationType: 'SALE' })).toBe(true);
    expect(addsTax(null)).toBe(true);
  });
});

describe('toCartLineView', () => {
  const line: SaleCartLine = {
    product: { uuid: 'product-uuid', name: 'Zapatillas', totalStock: 10 },
    quantity: 2,
    unitPrice: 1000,
    priceListUuid: PRINCIPAL,
    chosenPriceListUuid: null,
    taxRate: 21,
    chosenBatch: null,
    serials: [],
    packaging: null,
  };

  it('breaks out the tax when the voucher adds it', () => {
    const view = toCartLineView(line, DEFAULT_PRICE_ROUNDING, true);

    expect(view.amounts).toEqual({
      unitPrice: 1000,
      discountAmount: 0,
      netAmount: 2000,
      taxAmount: 420,
      subtotal: 2420,
    });
  });

  /** Factura B o C: se cobra el importe de la lista y el impuesto no se suma ni se discrimina. */
  it('charges the list amount as is when the voucher adds no tax', () => {
    const view = toCartLineView(line, DEFAULT_PRICE_ROUNDING, false);

    expect(view.amounts?.taxAmount).toBe(0);
    expect(view.amounts?.subtotal).toBe(2000);
  });

  it('flags the line that no applicable list gave a price for', () => {
    const view = toCartLineView({ ...line, unitPrice: null }, DEFAULT_PRICE_ROUNDING, true);

    expect(view.priceIssue).toBe('NO_PRICE');
    expect(view.amounts).toBeNull();
  });

  /** Un cero no es una promoción: es una lista sin cargar, y regalar la mercadería es peor. */
  it('flags a zero price instead of selling for free', () => {
    const view = toCartLineView({ ...line, unitPrice: 0 }, DEFAULT_PRICE_ROUNDING, true);

    expect(view.priceIssue).toBe('ZERO_PRICE');
  });

  /** El criterio es por línea: lo declara la regla que alcanza a *ese* producto. */
  it('rounds with the criterion the line was given', () => {
    const view = toCartLineView(
      { ...line, quantity: 1, unitPrice: 1234 },
      { mode: 'MULTIPLE_100', direction: 'UP' },
      false,
    );

    expect(view.amounts?.unitPrice).toBe(1300);
    expect(view.amounts?.subtotal).toBe(1300);
  });
});
