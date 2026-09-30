import { describe, expect, it } from 'vitest';
import {
  ProductPaginateDto,
  isArchivedProduct,
  resolveStockLevel,
  saleStatusFlagsOf,
} from './product.model';

function product(fields: Partial<ProductPaginateDto>): ProductPaginateDto {
  return { uuid: 'product-uuid', name: 'Zapatillas', ...fields };
}

describe('resolveStockLevel', () => {
  it('walks the thresholds from worst to best', () => {
    const thresholds = { lowStock: 5, optimalStock: 40 };

    expect(resolveStockLevel(product({ ...thresholds, totalStock: 0 }))).toBe('out');
    expect(resolveStockLevel(product({ ...thresholds, totalStock: 5 }))).toBe('low');
    expect(resolveStockLevel(product({ ...thresholds, totalStock: 6 }))).toBe('belowOptimal');
    expect(resolveStockLevel(product({ ...thresholds, totalStock: 40 }))).toBe('optimal');
  });

  /** El faltante es un dato del backend, no una opinión de los umbrales. */
  it('reports no stock even without thresholds', () => {
    expect(resolveStockLevel(product({ totalStock: 0 }))).toBe('out');
    expect(resolveStockLevel(product({ totalStock: null }))).toBe('out');
    expect(resolveStockLevel(product({ totalStock: -3 }))).toBe('out');
  });

  it('leaves the cell neutral when the product has no thresholds', () => {
    expect(resolveStockLevel(product({ totalStock: 12 }))).toBe('unknown');
    expect(resolveStockLevel(product({ totalStock: 12, lowStock: null, optimalStock: null }))).toBe(
      'unknown',
    );
  });

  /** Sin control de existencias no hay saldo: la pregunta no aplica, y no es «sin stock». */
  it('reports the product as not tracked before looking at any number', () => {
    expect(resolveStockLevel(product({ tracksStock: false, totalStock: null }))).toBe('notTracked');
    expect(resolveStockLevel(product({ stockTracking: 'NONE', totalStock: 0, lowStock: 5 }))).toBe(
      'notTracked',
    );
    expect(resolveStockLevel(product({ tracksStock: true, totalStock: 0 }))).toBe('out');
  });

  it('uses the only threshold loaded', () => {
    expect(resolveStockLevel(product({ totalStock: 12, lowStock: 20 }))).toBe('low');
    expect(resolveStockLevel(product({ totalStock: 12, lowStock: 5 }))).toBe('optimal');
    expect(resolveStockLevel(product({ totalStock: 12, optimalStock: 40 }))).toBe('belowOptimal');
    expect(resolveStockLevel(product({ totalStock: 40, optimalStock: 40 }))).toBe('optimal');
  });
});

describe('saleStatusFlagsOf', () => {
  /**
   * La regla la leen dos lugares —el paginador de la grilla y la consulta de variantes de un
   * modelo—, y escrita dos veces se desincronizaba: expandir un modelo contradecía al filtro de
   * arriba.
   */
  it('«en venta» pide sólo la bandera de venta', () => {
    expect(saleStatusFlagsOf('onSale')).toEqual([
      { filterKey: 'forSale', columna: 'is_for_sale', value: true },
    ]);
  });

  it('«discontinuado» pide las dos apagadas, que es la definición del ADR 0001', () => {
    expect(saleStatusFlagsOf('discontinued')).toEqual([
      { filterKey: 'forSale', columna: 'is_for_sale', value: false },
      { filterKey: 'forPurchase', columna: 'is_for_purchase', value: false },
    ]);
  });

  it('«todos» no impone ninguna: es la ausencia de filtro', () => {
    expect(saleStatusFlagsOf(null)).toEqual([]);
  });

  /**
   * Los dos estados con nombre no son complementarios, y ahí está el punto de que el select tenga
   * tres opciones: el producto que se compra y no se vende no entra en ninguno de los dos.
   */
  it('no son complementarios: «en venta» no es la negación de «discontinuado»', () => {
    const onSale = saleStatusFlagsOf('onSale');
    const discontinued = saleStatusFlagsOf('discontinued');

    expect(onSale).toHaveLength(1);
    expect(discontinued).toHaveLength(2);
  });
});

describe('isArchivedProduct', () => {
  it('reconoce el borrado logico del Core', () => {
    expect(isArchivedProduct({ status: -1 })).toBe(true);
  });

  it('el producto vivo no esta archivado', () => {
    expect(isArchivedProduct({ status: 1 })).toBe(false);
  });

  /**
   * El `-2` es la baja **temporal** del Core: se reactiva, así que su ficha se sigue editando. Sólo
   * el `-1` es la salida definitiva del catálogo (ADR 0001).
   */
  it('la baja temporal no es archivado', () => {
    expect(isArchivedProduct({ status: -2 })).toBe(false);
  });

  /**
   * Un backend anterior a `6.9.0` no informa `status` en el detalle. Ausente es «no sé», y abrir en
   * sólo lectura por las dudas dejaría sin editar a todo el catálogo.
   */
  it('sin status la ficha se edita como siempre', () => {
    expect(isArchivedProduct({})).toBe(false);
  });
});
