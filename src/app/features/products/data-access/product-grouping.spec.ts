import { describe, expect, it } from 'vitest';
import { ProductPaginateDto } from './product.model';
import {
  INLINE_VARIANTS_LIMIT,
  ProductCatalogRowDto,
  ProductModelGroupRow,
  ProductMoreVariantsRow,
  priceRangeOf,
  toRows,
} from './product-grouping';

const LIST = 'list-retail';
const MODEL = 'model-tee';

function variant(uuid: string, sku: string, price: number | null): ProductPaginateDto {
  return {
    uuid,
    name: `Remera ${sku}`,
    sku,
    totalStock: 0,
    model: { uuid: MODEL, name: 'Remera Lisa Basica' },
    priceListEntries: price === null ? [] : [{ priceListUuid: LIST, price }],
  } as ProductPaginateDto;
}

function modelRow(variantsCount: number): ProductCatalogRowDto {
  return {
    rowType: 'MODEL',
    model: {
      uuid: MODEL,
      name: 'Remera Lisa Basica',
      skuPrefix: 'REMLIS-S',
      variantsCount,
      priceFrom: 10000,
      priceTo: 10000,
      totalStock: 0,
    },
  };
}

function productRow(uuid: string, name: string): ProductCatalogRowDto {
  return {
    rowType: 'PRODUCT',
    product: { uuid, name, sku: uuid.toUpperCase(), totalStock: 5 } as ProductPaginateDto,
  };
}

/** Las dieciséis variantes del caso que reportó el usuario. */
const SIXTEEN = Array.from({ length: 16 }, (_, i) => variant(`v${i}`, `REMLIS-${i}`, 10000));

describe('toRows', () => {
  it('el modelo es una sola fila del catálogo, venga con las variantes que venga', () => {
    const rows = toRows([modelRow(16)], new Set(), new Map(), new Set());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'model', variantsCount: 16 });
  });

  /*
   * Expandir muestra un asomo del modelo, no las dieciséis: con la página en diez filas, un modelo
   * desplegado entero era la página entera. El resto se resume en el pie que lleva a su ficha.
   */
  it('expandido dibuja las primeras variantes y resume el resto', () => {
    const rows = toRows([modelRow(16)], new Set([MODEL]), new Map([[MODEL, SIXTEEN]]), new Set());

    expect(rows).toHaveLength(INLINE_VARIANTS_LIMIT + 2);
    expect(rows.filter((row) => row.kind === 'product')).toHaveLength(INLINE_VARIANTS_LIMIT);
    expect(
      rows
        .slice(1, INLINE_VARIANTS_LIMIT + 1)
        .every((row) => row.kind === 'product' && row.isVariant),
    ).toBe(true);
  });

  it('el pie dice cuántas quedaron y de qué modelo, que es a dónde lleva', () => {
    const rows = toRows([modelRow(16)], new Set([MODEL]), new Map([[MODEL, SIXTEEN]]), new Set());
    const footer = rows[rows.length - 1] as ProductMoreVariantsRow;

    expect(footer.kind).toBe('moreVariants');
    expect(footer.hiddenCount).toBe(16 - INLINE_VARIANTS_LIMIT);
    expect(footer.modelUuid).toBe(MODEL);
    expect(footer.modelName).toBe('Remera Lisa Basica');
  });

  it('sin variantes de sobra no hay pie que ofrecer', () => {
    const justFits = SIXTEEN.slice(0, INLINE_VARIANTS_LIMIT);
    const rows = toRows(
      [modelRow(INLINE_VARIANTS_LIMIT)],
      new Set([MODEL]),
      new Map([[MODEL, justFits]]),
      new Set(),
    );

    expect(rows).toHaveLength(INLINE_VARIANTS_LIMIT + 1);
    expect(rows.some((row) => row.kind === 'moreVariants')).toBe(false);
  });

  it('colapsado no dibuja ninguna variante, aunque estén cargadas', () => {
    const rows = toRows([modelRow(16)], new Set(), new Map([[MODEL, SIXTEEN]]), new Set());

    expect(rows).toHaveLength(1);
  });

  it('mientras se piden las variantes la fila lo informa', () => {
    const rows = toRows([modelRow(16)], new Set([MODEL]), new Map(), new Set([MODEL]));

    expect((rows[0] as ProductModelGroupRow).loadingVariants).toBe(true);
    // Todavía no hay variantes que dibujar: la fila está sola.
    expect(rows).toHaveLength(1);
  });

  it('los productos sueltos se siguen viendo como siempre', () => {
    const rows = toRows(
      [productRow('p1', 'Amoxicilina'), modelRow(16), productRow('p2', 'Tomate')],
      new Set(),
      new Map(),
      new Set(),
    );

    // Sin modelos expandidos no hay pie de «…N variantes más»: si apareciera, su `kind` rompe la lista.
    expect(
      rows.map((row) =>
        row.kind === 'model' ? row.name : row.kind === 'product' ? row.product.name : row.kind,
      ),
    ).toEqual(['Amoxicilina', 'Remera Lisa Basica', 'Tomate']);
  });

  it('el modelo no tiene SKU propio: muestra su prefijo (RN-12)', () => {
    const rows = toRows([modelRow(16)], new Set(), new Map(), new Set());

    expect((rows[0] as ProductModelGroupRow).skuPrefix).toBe('REMLIS-S—');
  });

  it('sin prefijo no inventa un SKU', () => {
    const row = modelRow(16);
    row.model!.skuPrefix = null;

    expect(
      (toRows([row], new Set(), new Map(), new Set())[0] as ProductModelGroupRow).skuPrefix,
    ).toBe('');
  });

  it('una fila de modelo sin modelo no se dibuja en vez de romper la tabla', () => {
    expect(toRows([{ rowType: 'MODEL' }], new Set(), new Map(), new Set())).toEqual([]);
  });
});

describe('priceRangeOf', () => {
  it('el rango va del precio más bajo al más alto de las variantes', () => {
    const range = priceRangeOf(
      [variant('v1', 'a', 12000), variant('v2', 'b', 12500), variant('v3', 'c', 12000)],
      LIST,
    );

    expect(range).toEqual({ from: 12000, to: 12500 });
  });

  it('sin precios en esa lista no hay rango que mostrar', () => {
    expect(priceRangeOf([variant('v1', 'a', null)], LIST)).toBeNull();
  });
});
