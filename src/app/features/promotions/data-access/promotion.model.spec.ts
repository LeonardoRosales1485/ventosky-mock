import { describe, expect, it } from 'vitest';
import {
  ALL_PROMOTION_TYPES_ENABLED,
  PROMOTION_TYPES,
  SELECTABLE_PROMOTION_TYPES,
  PromotionDto,
  PromotionFormValue,
  eligibleSetOf,
  isPromotionDimmed,
  promotionStateOf,
  promotionTypeChipOf,
  promotionValidationIssues,
  defaultCombinableFor,
  toPromotionFormValue,
  toPromotionSavePayload,
  typeOptionsFor,
  typeParamsOf,
} from './promotion.model';

const TODAY = '2026-09-18';

function promotion(overrides: Partial<PromotionDto> = {}): PromotionDto {
  return {
    uuid: 'promo-1',
    name: '10 % en gaseosas',
    type: 'PERCENTAGE',
    scope: 'PRODUCTS',
    percent: 10,
    validFrom: '2026-09-01',
    isDiscontinued: false,
    isCombinable: true,
    ...overrides,
  };
}

function formValue(overrides: Partial<PromotionFormValue> = {}): PromotionFormValue {
  return {
    name: '10 % en gaseosas',
    description: '',
    type: 'PERCENTAGE',
    scope: 'PRODUCTS',
    percent: 10,
    amount: null,
    buyQuantity: null,
    payQuantity: null,
    validFrom: '2026-09-01',
    validUntil: null,
    isDiscontinued: false,
    isCombinable: true,
    productUuids: ['prod-1'],
    categoryUuids: [],
    customerUuids: [],
    branchUuids: [],
    paymentMethodUuids: [],
    ...overrides,
  };
}

describe('promotionStateOf', () => {
  it('reads a promotion that started and has not ended as in force', () => {
    expect(promotionStateOf(promotion(), TODAY)).toBe('ACTIVE');
  });

  it('reads a promotion that starts tomorrow as scheduled', () => {
    expect(promotionStateOf(promotion({ validFrom: '2026-09-19' }), TODAY)).toBe('SCHEDULED');
  });

  /** El día de inicio y el de fin cuentan enteros: la promoción rige desde las 00:00 y hasta las 23:59. */
  it('counts the first and the last day as in force', () => {
    expect(promotionStateOf(promotion({ validFrom: TODAY }), TODAY)).toBe('ACTIVE');
    expect(promotionStateOf(promotion({ validUntil: TODAY }), TODAY)).toBe('ACTIVE');
  });

  it('reads a promotion whose end date passed as expired', () => {
    expect(promotionStateOf(promotion({ validUntil: '2026-09-17' }), TODAY)).toBe('EXPIRED');
  });

  /** Sin fecha de fin corre hasta que alguien la apague: el calendario no la vence nunca. */
  it('never expires a promotion without an end date', () => {
    expect(promotionStateOf(promotion({ validUntil: null }), TODAY)).toBe('ACTIVE');
    expect(promotionStateOf(promotion({ validFrom: '2020-01-01' }), '2099-12-31')).toBe('ACTIVE');
  });

  /** El interruptor manual gana sobre el calendario: si no, discontinuar no se vería en el listado. */
  it('reads a discontinued promotion as discontinued even inside its own dates', () => {
    expect(promotionStateOf(promotion({ isDiscontinued: true }), TODAY)).toBe('DISCONTINUED');
    expect(
      promotionStateOf(promotion({ isDiscontinued: true, validFrom: '2026-09-19' }), TODAY),
    ).toBe('DISCONTINUED');
  });
});

describe('isPromotionDimmed', () => {
  /** Vencidas y discontinuadas se atenúan, pero no se esconden: hay que poder reactivarlas. */
  it('dims what no longer discounts and leaves the rest alone', () => {
    expect(isPromotionDimmed('EXPIRED')).toBe(true);
    expect(isPromotionDimmed('DISCONTINUED')).toBe(true);
    expect(isPromotionDimmed('ACTIVE')).toBe(false);
    expect(isPromotionDimmed('SCHEDULED')).toBe(false);
  });
});

describe('promotionTypeChipOf', () => {
  it('describes each type with the numbers its chip shows', () => {
    expect(promotionTypeChipOf(promotion({ type: 'PERCENTAGE', percent: 10 }))).toEqual({
      kind: 'PERCENTAGE',
      percent: 10,
    });
    expect(
      promotionTypeChipOf(promotion({ type: 'FIXED_AMOUNT', percent: null, amount: 500 })),
    ).toEqual({ kind: 'FIXED_AMOUNT', amount: 500 });
    expect(
      promotionTypeChipOf(
        promotion({ type: 'NXM', percent: null, buyQuantity: 3, payQuantity: 2 }),
      ),
    ).toEqual({ kind: 'NXM', buyQuantity: 3, payQuantity: 2 });
  });

  /** Una fila con el tipo o los parámetros incompletos se dibuja, no rompe el listado. */
  it('falls back to unknown when the row cannot be read', () => {
    expect(promotionTypeChipOf(promotion({ type: null }))).toEqual({ kind: 'UNKNOWN' });
    expect(promotionTypeChipOf(promotion({ percent: null }))).toEqual({ kind: 'UNKNOWN' });
  });
});

describe('eligibleSetOf', () => {
  it('counts both collections of a products promotion', () => {
    expect(
      eligibleSetOf(
        promotion({
          products: [
            { uuid: 'p1', name: 'Coca 1,5 L' },
            { uuid: 'p2', name: 'Sprite 1,5 L' },
          ],
          categories: [{ uuid: 'c1', name: 'Gaseosas' }],
        }),
      ),
    ).toEqual({ scope: 'PRODUCTS', products: 2, categories: 1 });
  });

  /** Una promoción sobre el total no tiene conjunto elegible: alcanza la venta entera. */
  it('reports an order-total promotion as reaching the whole sale', () => {
    expect(eligibleSetOf(promotion({ scope: 'ORDER_TOTAL', products: [] }))).toEqual({
      scope: 'ORDER_TOTAL',
      products: 0,
      categories: 0,
    });
  });
});

describe('promotionValidationIssues', () => {
  it('accepts the three shapes the backend accepts', () => {
    expect(promotionValidationIssues(formValue())).toEqual([]);
    expect(
      promotionValidationIssues(
        formValue({
          type: 'FIXED_AMOUNT',
          percent: null,
          amount: 500,
          scope: 'ORDER_TOTAL',
          productUuids: [],
        }),
      ),
    ).toEqual([]);
    expect(
      promotionValidationIssues(
        formValue({ type: 'NXM', percent: null, buyQuantity: 3, payQuantity: 2 }),
      ),
    ).toEqual([]);
  });

  it('rejects a percentage outside 0 < p ≤ 100', () => {
    expect(promotionValidationIssues(formValue({ percent: 0 }))).toContain('percentRange');
    expect(promotionValidationIssues(formValue({ percent: 101 }))).toContain('percentRange');
    expect(promotionValidationIssues(formValue({ percent: 100 }))).toEqual([]);
  });

  it('rejects a fixed amount that is not positive', () => {
    expect(
      promotionValidationIssues(formValue({ type: 'FIXED_AMOUNT', percent: null, amount: 0 })),
    ).toContain('amountPositive');
  });

  /** V4: N tiene que ser mayor que M, y M al menos 1 — un 2x0 es regalar, no promocionar. */
  it('rejects an NxM whose N is not greater than M', () => {
    const nxm = (buyQuantity: number | null, payQuantity: number | null) =>
      promotionValidationIssues(
        formValue({ type: 'NXM', percent: null, buyQuantity, payQuantity }),
      );

    expect(nxm(2, 2)).toContain('nxmQuantities');
    expect(nxm(1, 2)).toContain('nxmQuantities');
    expect(nxm(2, 0)).toContain('nxmQuantities');
    expect(nxm(null, 2)).toContain('nxmQuantities');
    expect(nxm(2, 1)).toEqual([]);
  });

  /** V5: el NxM cuenta unidades, así que no puede pegarle al total de la venta. */
  it('rejects an NxM scoped to the order total', () => {
    expect(
      promotionValidationIssues(
        formValue({
          type: 'NXM',
          percent: null,
          buyQuantity: 3,
          payQuantity: 2,
          scope: 'ORDER_TOTAL',
        }),
      ),
    ).toContain('nxmRequiresProducts');
  });

  /** V6: una promoción de productos sin conjunto elegible no alcanza a nada. */
  it('rejects a products promotion with neither products nor categories', () => {
    expect(promotionValidationIssues(formValue({ productUuids: [] }))).toContain(
      'eligibleSetRequired',
    );
    expect(
      promotionValidationIssues(formValue({ productUuids: [], categoryUuids: ['c1'] })),
    ).toEqual([]);
  });

  /** V7: el inicio es obligatorio y el fin, si viene, no puede ser anterior. */
  it('rejects a missing start date and an end date before it', () => {
    expect(promotionValidationIssues(formValue({ validFrom: '' }))).toContain('validFromRequired');
    expect(promotionValidationIssues(formValue({ validUntil: '2026-08-31' }))).toContain(
      'datesInverted',
    );
    expect(promotionValidationIssues(formValue({ validUntil: '2026-09-01' }))).toEqual([]);
  });
});

describe('toPromotionSavePayload', () => {
  /**
   * V9: cada tipo manda sus parámetros y los de los otros en `null`. Viajan siempre —no se omiten—
   * porque cambiar el tipo de una promoción guardada tiene que poder borrar el valor anterior.
   */
  it('sends only the parameters of the chosen type, nulling the others', () => {
    expect(toPromotionSavePayload(formValue(), undefined, undefined)).toMatchObject({
      percent: 10,
      amount: null,
      buyQuantity: null,
      payQuantity: null,
    });

    expect(
      toPromotionSavePayload(
        formValue({ type: 'NXM', percent: 10, amount: 500, buyQuantity: 3, payQuantity: 2 }),
        undefined,
        undefined,
      ),
    ).toMatchObject({ percent: null, amount: null, buyQuantity: 3, payQuantity: 2 });
  });

  /** Las cinco colecciones viajan siempre: el backend sincroniza con lo recibido, omitir no desvincula. */
  it('always sends the five scope collections as uuid references', () => {
    expect(
      toPromotionSavePayload(
        formValue({ productUuids: ['p1'], customerUuids: ['c1', 'c2'] }),
        undefined,
        undefined,
      ),
    ).toMatchObject({
      products: [{ uuid: 'p1' }],
      categories: [],
      customers: [{ uuid: 'c1' }, { uuid: 'c2' }],
      branches: [],
      paymentMethods: [],
    });
  });

  /** Un alta no lleva `uuid` ni `version`: sin registro previo no hay nada con lo que chocar. */
  it('carries uuid and version only when editing', () => {
    expect(toPromotionSavePayload(formValue(), undefined, undefined)).not.toHaveProperty('uuid');
    expect(toPromotionSavePayload(formValue(), 'promo-1', 4)).toMatchObject({
      uuid: 'promo-1',
      version: 4,
    });
  });

  it('trims the name and turns an empty description into null', () => {
    expect(
      toPromotionSavePayload(
        formValue({ name: '  Aniversario  ', description: '   ' }),
        undefined,
        undefined,
      ),
    ).toMatchObject({ name: 'Aniversario', description: null });
  });

  /** Sin fecha de fin la promoción corre hasta que se discontinúe: viaja `null`, no la de inicio. */
  it('sends a missing end date as null', () => {
    expect(
      toPromotionSavePayload(formValue({ validUntil: null }), undefined, undefined),
    ).toMatchObject({ validFrom: '2026-09-01', validUntil: null });
  });
});

describe('toPromotionFormValue', () => {
  it('turns the five scope collections into the uuids the form edits', () => {
    expect(
      toPromotionFormValue(
        promotion({
          products: [{ uuid: 'p1', name: 'Coca 1,5 L' }],
          categories: [{ uuid: 'c1', name: 'Gaseosas' }],
          customers: [{ uuid: 'cust-1', name: 'Kiosco Luján' }],
          branches: [{ uuid: 'b1', name: 'Centro' }],
          paymentMethods: [{ uuid: 'pm1', name: 'Efectivo' }],
        }),
      ),
    ).toMatchObject({
      productUuids: ['p1'],
      categoryUuids: ['c1'],
      customerUuids: ['cust-1'],
      branchUuids: ['b1'],
      paymentMethodUuids: ['pm1'],
    });
  });

  /** Ausente es acumulable: es el default de la columna, y leerlo como `false` cerraría la cascada. */
  it('reads a missing combinable flag as combinable', () => {
    expect(toPromotionFormValue(promotion({ isCombinable: null })).isCombinable).toBe(true);
    expect(toPromotionFormValue(promotion({ isCombinable: false })).isCombinable).toBe(false);
  });

  /**
   * Discontinuar es un guardado con la bandera invertida, y el alcance tiene que viajar entero: el
   * backend sincroniza las colecciones con lo recibido, así que mandar el encabezado solo lo borra.
   */
  it('round-trips a promotion through the payload keeping its whole scope', () => {
    const saved = promotion({
      products: [{ uuid: 'p1', name: 'Coca 1,5 L' }],
      branches: [{ uuid: 'b1', name: 'Centro' }],
      validUntil: '2026-12-31',
      version: 7,
    });

    const payload = toPromotionSavePayload(
      { ...toPromotionFormValue(saved), isDiscontinued: true },
      saved.uuid,
      saved.version,
    );

    expect(payload).toMatchObject({
      uuid: 'promo-1',
      version: 7,
      isDiscontinued: true,
      percent: 10,
      validFrom: '2026-09-01',
      validUntil: '2026-12-31',
      products: [{ uuid: 'p1' }],
      branches: [{ uuid: 'b1' }],
    });
  });
});

describe('typeParamsOf', () => {
  const params = { percent: 10, amount: 500, buyQuantity: 3, payQuantity: 2 };

  /**
   * V9: el backend rechaza una promoción que viaje con parámetros de otro tipo, así que esta regla
   * gobierna dos cosas a la vez — qué se manda al guardar y qué se borra al cambiar de tipo.
   */
  it('keeps only the parameters the chosen type owns', () => {
    expect(typeParamsOf({ ...params, type: 'PERCENTAGE' })).toEqual({
      percent: 10,
      amount: null,
      buyQuantity: null,
      payQuantity: null,
    });
    expect(typeParamsOf({ ...params, type: 'FIXED_AMOUNT' })).toEqual({
      percent: null,
      amount: 500,
      buyQuantity: null,
      payQuantity: null,
    });
    expect(typeParamsOf({ ...params, type: 'NXM' })).toEqual({
      percent: null,
      amount: null,
      buyQuantity: 3,
      payQuantity: 2,
    });
  });

  it('empties every parameter for a type it does not know', () => {
    expect(typeParamsOf({ ...params, type: 'WHATEVER' })).toEqual({
      percent: null,
      amount: null,
      buyQuantity: null,
      payQuantity: null,
    });
  });
});

describe('defaultCombinableFor', () => {
  /** Las NxM nacen no acumulables: una línea con un 3x2 no recibe además un porcentaje (§4.7). */
  it('starts an NxM as not stackable and everything else as stackable', () => {
    expect(defaultCombinableFor('NXM')).toBe(false);
    expect(defaultCombinableFor('PERCENTAGE')).toBe(true);
    expect(defaultCombinableFor('FIXED_AMOUNT')).toBe(true);
  });
});

/**
 * El interruptor que acota qué tipos ofrece el ABM. Los casos están escritos **derivando del
 * interruptor** y no de su valor de hoy: prenderlo es una operación soportada y no tiene por qué
 * poner un test en rojo.
 */
describe('SELECTABLE_PROMOTION_TYPES', () => {
  it('no recorta lo que el sistema conoce', () => {
    // Acotar el selector no puede acotar lo que la app sabe **mostrar**: el chip del listado y el
    // desglose de la venta siguen teniendo que dibujar los tres.
    expect(PROMOTION_TYPES).toEqual(['PERCENTAGE', 'FIXED_AMOUNT', 'NXM']);
  });

  it('apagado ofrece solo la porcentual; prendido, los tres', () => {
    expect(SELECTABLE_PROMOTION_TYPES).toEqual(
      ALL_PROMOTION_TYPES_ENABLED ? [...PROMOTION_TYPES] : ['PERCENTAGE'],
    );
  });

  it('la porcentual se ofrece en los dos estados', () => {
    // Es el default de una promoción nueva: si quedara fuera, el alta abriría sin tipo elegible.
    expect(SELECTABLE_PROMOTION_TYPES).toContain('PERCENTAGE');
  });
});

describe('typeOptionsFor', () => {
  const hidden = PROMOTION_TYPES.find(
    (type) => !SELECTABLE_PROMOTION_TYPES.some((offered) => offered === type),
  );

  it('sin tipo elegido ofrece los del interruptor', () => {
    // Es el filtro del listado en blanco: no hay ningún tipo que agregar.
    expect(typeOptionsFor(null)).toEqual([...SELECTABLE_PROMOTION_TYPES]);
    expect(typeOptionsFor(undefined)).toEqual([...SELECTABLE_PROMOTION_TYPES]);
    expect(typeOptionsFor('')).toEqual([...SELECTABLE_PROMOTION_TYPES]);
  });

  it('un tipo ya ofrecido no se duplica', () => {
    expect(typeOptionsFor('PERCENTAGE')).toEqual([...SELECTABLE_PROMOTION_TYPES]);
  });

  it('una promocion guardada con un tipo oculto conserva el suyo', () => {
    // Es el caso que no se puede romper: una NxM guardada antes de apagar el interruptor. Sin su
    // propia opción el select abriría en blanco, y el primer cambio en cualquier otro campo la
    // guardaría convertida en otra cosa.
    if (!hidden) {
      // Con el interruptor prendido no hay tipo oculto: no hay nada que conservar.
      expect(SELECTABLE_PROMOTION_TYPES).toEqual([...PROMOTION_TYPES]);
      return;
    }

    expect(typeOptionsFor(hidden)).toContain(hidden);
    expect(typeOptionsFor(hidden)).toContain('PERCENTAGE');
  });

  it('un tipo que ni el sistema conoce tambien se conserva', () => {
    // Un cuarto tipo que el backend sume mañana: la pantalla lo muestra en vez de abrir en blanco.
    expect(typeOptionsFor('BUNDLE')).toContain('BUNDLE');
  });
});
