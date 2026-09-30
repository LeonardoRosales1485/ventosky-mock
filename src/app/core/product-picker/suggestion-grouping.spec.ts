import { describe, expect, it } from 'vitest';
import { SuggestionProduct, collapseByModel, suggestionKey } from './suggestion-grouping';

function variant(uuid: string, label: string, stock: number): SuggestionProduct {
  return {
    uuid,
    name: `Remera ${label}`,
    totalStock: stock,
    model: { uuid: 'model-tee', name: 'Remera Básica Algodón' },
  };
}

function loose(uuid: string, name: string, stock = 3): SuggestionProduct {
  return { uuid, name, totalStock: stock };
}

describe('collapseByModel', () => {
  it('doce variantes no inundan la lista: el modelo aparece una sola vez', () => {
    const rows = collapseByModel([
      variant('v1', 'S/Rojo', 4),
      variant('v2', 'M/Rojo', 8),
      variant('v3', 'M/Negro', 9),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'model', modelName: 'Remera Básica Algodón' });
  });

  it('la fila del modelo suma el stock de sus variantes', () => {
    const rows = collapseByModel([variant('v1', 'S/Rojo', 4), variant('v2', 'M/Rojo', 8)]);

    expect(rows[0]).toMatchObject({ totalStock: 12 });
  });

  it('guarda las variantes que colapsó: son las que va a ofrecer el selector', () => {
    const rows = collapseByModel([variant('v1', 'S/Rojo', 4), variant('v2', 'M/Rojo', 8)]);

    expect(rows[0].kind === 'model' && rows[0].variants).toHaveLength(2);
  });

  it('los productos sueltos no cambian en nada', () => {
    const rows = collapseByModel([loose('p1', 'Coca 500'), loose('p2', 'Alfajor')]);

    expect(rows.map((row) => row.kind)).toEqual(['product', 'product']);
  });

  it('el modelo aparece donde apareció su primera variante: el orden del buscador se respeta', () => {
    const rows = collapseByModel([
      loose('p1', 'Coca 500'),
      variant('v1', 'S/Rojo', 4),
      loose('p2', 'Alfajor'),
    ]);

    expect(
      rows.map((row) => (row.kind === 'model' ? row.modelName : row.product.name)),
    ).toEqual(['Coca 500', 'Remera Básica Algodón', 'Alfajor']);
  });

  it('dos modelos distintos no se mezclan', () => {
    const other: SuggestionProduct = {
      ...variant('n1', '16/512', 2),
      model: { uuid: 'model-nb', name: 'Notebook' },
    };
    const rows = collapseByModel([variant('v1', 'S/Rojo', 4), other]);

    expect(rows).toHaveLength(2);
  });

  /** La fila conserva el tipo de lo que colapsó: quien la elige recibe el producto que ya conoce. */
  it('devuelve el producto con su tipo, sin volver a pedirlo', () => {
    interface Priced extends SuggestionProduct {
      price: number;
    }
    const rows = collapseByModel<Priced>([{ ...loose('p1', 'Coca 500'), price: 1500 }]);

    expect(rows[0].kind === 'product' && rows[0].product.price).toBe(1500);
  });
});

describe('suggestionKey', () => {
  it('el modelo se identifica por su uuid y el producto por el suyo', () => {
    const [model] = collapseByModel([variant('v1', 'S/Rojo', 4)]);
    const [product] = collapseByModel([loose('p1', 'Coca 500')]);

    expect(suggestionKey(model)).toBe('model-tee');
    expect(suggestionKey(product)).toBe('p1');
  });
});
