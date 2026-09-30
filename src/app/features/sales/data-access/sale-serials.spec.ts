import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_ROUNDING } from '../../../core/pricing/price-rounding';
import { SaleCartLine, SaleProductDto, isSerialTracked, toCartLineView } from './sale.model';

const NOTEBOOK: SaleProductDto = {
  uuid: 'nb',
  name: 'Notebook Aureo 14"',
  stockTracking: 'SERIAL',
  taxRate: 21,
};

const SCREW: SaleProductDto = {
  uuid: 'screw',
  name: 'Tornillo',
  stockTracking: 'QUANTITY',
  taxRate: 21,
};

const line = (
  product: SaleProductDto,
  quantity: number,
  serials: readonly string[],
): SaleCartLine => ({
  product,
  quantity,
  unitPrice: 1000,
  priceListUuid: 'pl',
  chosenPriceListUuid: null,
  taxRate: 21,
  chosenBatch: null,
  serials,
  packaging: null,
});

const view = (product: SaleProductDto, quantity: number, serials: readonly string[]) =>
  toCartLineView(line(product, quantity, serials), DEFAULT_PRICE_ROUNDING, true);

/**
 * Las series de una línea del POS (§9). `serialShortage` es lo que apaga el botón de cobro y lo que
 * la fila muestra como «falta 1 serie»: el mostrador tiene que saber qué falta antes de pedirle la
 * tarjeta al cliente, no cuando el commit rebota.
 */
describe('serialShortage', () => {
  it('is zero for a product that does not carry serials', () => {
    const row = view(SCREW, 5, []);
    expect(row.serialTracked).toBe(false);
    expect(row.serialShortage).toBe(0);
  });

  it('counts how many are still missing', () => {
    expect(view(NOTEBOOK, 3, []).serialShortage).toBe(3);
    expect(view(NOTEBOOK, 3, ['SN-1']).serialShortage).toBe(2);
    expect(view(NOTEBOOK, 3, ['SN-1', 'SN-2', 'SN-3']).serialShortage).toBe(0);
  });

  /**
   * Nunca negativo: con más series que unidades el faltante es cero y la venta no se traba por acá.
   * El excedente se resuelve en el selector, que es donde el operador puede sacar una.
   */
  it('does not go negative when more serials than units were chosen', () => {
    expect(view(NOTEBOOK, 2, ['SN-1', 'SN-2', 'SN-3']).serialShortage).toBe(0);
  });

  it('marks the line as serial tracked so the row can show the chips', () => {
    expect(view(NOTEBOOK, 1, []).serialTracked).toBe(true);
  });
});

describe('isSerialTracked', () => {
  it('is true only for a SERIAL product', () => {
    expect(isSerialTracked(NOTEBOOK)).toBe(true);
    expect(isSerialTracked(SCREW)).toBe(false);
    expect(isSerialTracked({ stockTracking: 'BATCH' })).toBe(false);
    expect(isSerialTracked({ stockTracking: null })).toBe(false);
  });
});
