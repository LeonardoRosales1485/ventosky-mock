import { describe, expect, it } from 'vitest';
import { archiveConsequencesOf } from './product-archive';
import { ProductPaginateDto } from './product.model';

function product(fields: Partial<ProductPaginateDto>): ProductPaginateDto {
  return { uuid: 'p-1', name: 'Producto', ...fields } as ProductPaginateDto;
}

function keys(fields: Partial<ProductPaginateDto>): string[] {
  return archiveConsequencesOf(product(fields)).map((line) => line.labelKey);
}

describe('archiveConsequencesOf', () => {
  it('siempre dice que no se deshace', () => {
    // Es la mitad del ADR 0001 que el usuario no puede deducir de ninguna columna.
    expect(keys({})).toEqual(['products.archive.irreversible']);
  });

  it('dice cuántas unidades quedan sin poder venderse', () => {
    const [, stock] = archiveConsequencesOf(product({ tracksStock: true, totalStock: 12 }));
    expect(stock.labelKey).toBe('products.archive.stockLost');
    expect(stock.params).toEqual({ count: 12 });
  });

  it('no habla de stock cuando no hay saldo que perder', () => {
    expect(keys({ tracksStock: true, totalStock: 0 })).toEqual(['products.archive.irreversible']);
  });

  it('no habla de stock en un producto que no lleva existencias', () => {
    // Un servicio o un kit virtual: su `totalStock` es `null` por definición (RN-01).
    expect(keys({ tracksStock: false, totalStock: null })).toEqual([
      'products.archive.irreversible',
    ]);
  });

  it('avisa que el código vuelve al pool sólo si el producto nunca se movió', () => {
    const [, code] = archiveConsequencesOf(product({ hasMovements: false, sku: 'ABC-1' }));
    expect(code.labelKey).toBe('products.archive.codeReleased');
    expect(code.params).toEqual({ code: 'ABC-1' });
  });

  it('no promete nada del código del producto que ya se movió', () => {
    // Se lo queda para siempre: los índices de código son totales desde VTY-478.
    expect(keys({ hasMovements: true, sku: 'ABC-1' })).toEqual(['products.archive.irreversible']);
  });

  it('se calla cuando el backend no informa la historia', () => {
    // `hasMovements` ausente es «no sé», y el diálogo no adivina: prometer un código que no se
    // libera es peor que no decir nada.
    expect(keys({ sku: 'ABC-1' })).toEqual(['products.archive.irreversible']);
  });

  it('usa el código de barras cuando el producto no tiene SKU', () => {
    const [, code] = archiveConsequencesOf(product({ hasMovements: false, barcode: '779000' }));
    expect(code.params).toEqual({ code: '779000' });
  });

  it('no habla del código cuando el producto no tiene ninguno', () => {
    expect(keys({ hasMovements: false })).toEqual(['products.archive.irreversible']);
  });

  it('ordena las consecuencias de la más cara a la más barata', () => {
    expect(keys({ tracksStock: true, totalStock: 3, hasMovements: false, sku: 'ABC-1' })).toEqual([
      'products.archive.irreversible',
      'products.archive.stockLost',
      'products.archive.codeReleased',
    ]);
  });
});
