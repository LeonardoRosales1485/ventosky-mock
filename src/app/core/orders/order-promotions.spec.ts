import { describe, expect, it } from 'vitest';
import { OrderDto, OrderItemDto, OrderPromotionDto } from './order-commit.model';
import { appliedPromotionsOf } from './order-promotions';

function item(fields: Partial<OrderItemDto>): OrderItemDto {
  return { uuid: 'item-1', product: { uuid: 'prod-1', name: 'Alfajor Jorgito' }, ...fields };
}

function applied(fields: Partial<OrderPromotionDto>): OrderPromotionDto {
  return {
    uuid: 'row-1',
    promotion: { uuid: 'promo-1', name: 'Alfajores 3x2' },
    promotionType: 'NXM',
    promotionDetail: '3x2',
    bonusQuantity: 1,
    amount: 250,
    ...fields,
  };
}

function order(fields: Partial<OrderDto>): OrderDto {
  return { uuid: 'order-1', ...fields };
}

/**
 * Lo que ve quien abre una venta vieja: la entrada es el detalle que devuelve la API y la salida son
 * las filas de la sección. Nada se recalcula acá — los importes son los del día del cobro.
 */
describe('appliedPromotionsOf', () => {
  it('una venta con tres promociones produce tres filas, con su importe y su linea', () => {
    const section = appliedPromotionsOf(
      order({
        items: [
          item({ uuid: 'item-1', product: { uuid: 'p-1', name: 'Alfajor Jorgito' } }),
          item({ uuid: 'item-2', product: { uuid: 'p-2', name: 'Gaseosa 2L' } }),
        ],
        promotions: [
          applied({ uuid: 'row-1', orderItemUuid: 'item-1', amount: 250 }),
          applied({
            uuid: 'row-2',
            orderItemUuid: 'item-2',
            promotion: { uuid: 'promo-2', name: 'Gaseosas −10 %' },
            promotionType: 'PERCENTAGE',
            promotionDetail: '-10%',
            bonusQuantity: 0,
            amount: 180,
          }),
          applied({
            uuid: 'row-3',
            orderItemUuid: 'item-1',
            promotion: { uuid: 'promo-3', name: 'Cumpleaños −$50' },
            promotionType: 'FIXED_AMOUNT',
            promotionDetail: '-$50',
            bonusQuantity: 0,
            amount: 50,
          }),
        ],
      }),
    );

    expect(section?.rows.map((row) => [row.name, row.line, row.amount])).toEqual([
      ['Alfajores 3x2', 'Alfajor Jorgito', 250],
      ['Gaseosas −10 %', 'Gaseosa 2L', 180],
      ['Cumpleaños −$50', 'Alfajor Jorgito', 50],
    ]);
  });

  it('una promocion de ambito total produce una fila sin linea', () => {
    const section = appliedPromotionsOf(
      order({
        items: [item({})],
        promotions: [applied({ orderItemUuid: null, promotionDetail: '-5%' })],
      }),
    );

    expect(section?.rows[0].line).toBeNull();
    expect(section?.rows[0].onOrderTotal).toBe(true);
    expect(section?.hasOrderTotalRows).toBe(true);
  });

  it('una promocion sobre una linea no cuenta como de ambito total', () => {
    const section = appliedPromotionsOf(
      order({ items: [item({})], promotions: [applied({ orderItemUuid: 'item-1' })] }),
    );

    expect(section?.rows[0].onOrderTotal).toBe(false);
    expect(section?.hasOrderTotalRows).toBe(false);
  });

  it('un NxM muestra las unidades bonificadas y una porcentual deja la columna vacia', () => {
    const section = appliedPromotionsOf(
      order({
        items: [item({})],
        promotions: [
          applied({
            uuid: 'row-1',
            orderItemUuid: 'item-1',
            promotionType: 'NXM',
            bonusQuantity: 2,
          }),
          applied({
            uuid: 'row-2',
            orderItemUuid: 'item-1',
            promotionType: 'PERCENTAGE',
            promotionDetail: '-10%',
            bonusQuantity: 0,
          }),
        ],
      }),
    );

    expect(section?.rows[0].bonusQuantity).toBe(2);
    expect(section?.rows[1].bonusQuantity).toBeNull();
  });

  it('el total de la seccion es la suma de los importes de las filas', () => {
    const section = appliedPromotionsOf(
      order({
        items: [item({})],
        promotions: [
          applied({ uuid: 'row-1', orderItemUuid: 'item-1', amount: 250.55 }),
          applied({ uuid: 'row-2', orderItemUuid: 'item-1', amount: 180.9 }),
          applied({ uuid: 'row-3', orderItemUuid: null, amount: 12.35 }),
        ],
      }),
    );

    expect(section?.totalDiscountAmount).toBe(443.8);
  });

  it('una venta sin promociones no produce seccion', () => {
    expect(appliedPromotionsOf(order({ items: [item({})], promotions: [] }))).toBeNull();
    expect(appliedPromotionsOf(order({ items: [item({})] }))).toBeNull();
    expect(appliedPromotionsOf(order({ items: [item({})], promotions: null }))).toBeNull();
  });

  it('cada fila lleva su propio snapshot, no un texto resuelto por promocion', () => {
    // Las dos filas son **la misma promoción** —mismo `uuid`— con snapshots distintos: así quedaría
    // una venta cobrada en dos tramos alrededor de una edición. Si el modelo resolviera el texto por
    // promoción en vez de leerlo de cada fila, las dos saldrían con el mismo nombre, y una de las
    // dos estaría mintiendo sobre lo que se aplicó.
    //
    // Es la forma más fuerte de probarlo acá: la función no recibe el catálogo vivo, justamente para
    // que no haya de dónde sacar el nombre de hoy.
    const section = appliedPromotionsOf(
      order({
        items: [item({})],
        promotions: [
          applied({
            uuid: 'row-1',
            orderItemUuid: 'item-1',
            promotion: { uuid: 'promo-1', name: 'Alfajores 3x2 de marzo' },
            promotionDetail: '3x2',
          }),
          applied({
            uuid: 'row-2',
            orderItemUuid: 'item-1',
            promotion: { uuid: 'promo-1', name: 'Alfajores 4x3' },
            promotionDetail: '4x3',
          }),
        ],
      }),
    );

    expect(section?.rows.map((row) => [row.name, row.detail])).toEqual([
      ['Alfajores 3x2 de marzo', '3x2'],
      ['Alfajores 4x3', '4x3'],
    ]);
  });

  it('una fila cuya linea no vino en el detalle no se lee como de ambito total', () => {
    const section = appliedPromotionsOf(
      order({
        items: [item({ uuid: 'item-1' })],
        promotions: [applied({ orderItemUuid: 'item-9' })],
      }),
    );

    expect(section?.rows[0].line).toBeNull();
    expect(section?.rows[0].onOrderTotal).toBe(false);
    expect(section?.hasOrderTotalRows).toBe(false);
  });
});
