import { describe, expect, it } from 'vitest';
import { OrderDto } from '../../../core/orders/order-commit.model';
import { isEditablePurchase, isKitProduct } from './purchase.model';

/** Una fila del listado, con lo poco de lo que depende la decisión de editar. */
function purchase(overrides: Partial<OrderDto> = {}): OrderDto {
  return {
    uuid: 'orden-1',
    partyRole: { uuid: 'proveedor-1', name: 'Distribuidora Sur', role: 'SUPPLIER' },
    voucher: { uuid: 'comprobante-1', stockEffect: 'NONE', balanceEffect: 'NONE' },
    ...overrides,
  };
}

describe('isEditablePurchase', () => {
  /**
   * La orden de compra —comprobante sin ningún efecto— es lo único que el backend deja editar:
   * `POST /order/{uuid}/convert` la reemplaza y recién ahí aplica stock, costo y saldo.
   */
  it('accepts a purchase order whose voucher moved nothing', () => {
    expect(isEditablePurchase(purchase())).toBe(true);
  });

  /**
   * Con la mercadería ya ingresada no hay edición posible: `assertConvertible` responde 409
   * (`ORDER_ALREADY_APPLIED`), así que ofrecer el botón sería ofrecer un error.
   */
  it('rejects a purchase that already moved stock', () => {
    const applied = purchase({
      voucher: { uuid: 'comprobante-1', stockEffect: 'INCREMENT', balanceEffect: 'NONE' },
    });

    expect(isEditablePurchase(applied)).toBe(false);
  });

  /** Ídem con la cuenta corriente: alcanza con que uno de los dos efectos haya corrido. */
  it('rejects a purchase that already moved the balance', () => {
    const applied = purchase({
      voucher: { uuid: 'comprobante-1', stockEffect: 'NONE', balanceEffect: 'DECREMENT' },
    });

    expect(isEditablePurchase(applied)).toBe(false);
  });

  /**
   * Un efecto que no llega no es un `NONE`: el backend exige que los dos estén declarados en `NONE`
   * y trata al ausente como desconocido, así que la duda se resuelve no editando.
   */
  it('rejects a voucher that does not declare its effects', () => {
    expect(isEditablePurchase(purchase({ voucher: { uuid: 'comprobante-1' } }))).toBe(false);
    expect(isEditablePurchase(purchase({ voucher: null }))).toBe(false);
  });

  /**
   * Sin contraparte la conversión no se puede armar: una compra sin proveedor no existe, y el
   * backend la valida contra el `operationType` del comprobante.
   */
  it('rejects an order with no supplier', () => {
    expect(isEditablePurchase(purchase({ partyRole: null }))).toBe(false);
  });
});

describe('isKitProduct', () => {
  /**
   * Los dos modos se responden igual: ninguno se compra. El virtual no existe en ningún estante
   * (§6.1) y el armado se produce consumiendo los componentes (§6.6).
   */
  it('recognises a kit in either mode', () => {
    expect(isKitProduct({ type: 'KIT' })).toBe(true);
  });

  it('says nothing about a product that is not a kit', () => {
    expect(isKitProduct({ type: 'SIMPLE' })).toBe(false);
    expect(isKitProduct({ type: 'SERVICE' })).toBe(false);
    expect(isKitProduct({})).toBe(false);
  });
});
