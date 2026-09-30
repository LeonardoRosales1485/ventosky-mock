import { describe, expect, it } from 'vitest';
import { ProductModelOptionValue, ProductModelVariantDto } from '../../data-access/product-model.model';
import { MatrixAxis, buildMatrix, keyOf } from './variant-matrix';

function value(uuid: string, text: string, code?: string): ProductModelOptionValue {
  return { uuid, value: text, code: code ?? null };
}

const SIZE: MatrixAxis = {
  axisUuid: 'axis-size',
  axisName: 'Talle',
  values: [value('s', 'S', 'S'), value('m', 'M', 'M'), value('l', 'L', 'L')],
};

const COLOR: MatrixAxis = {
  axisUuid: 'axis-color',
  axisName: 'Color',
  values: [value('red', 'Rojo', 'RO'), value('black', 'Negro', 'NE')],
};

describe('buildMatrix', () => {
  it('multiplica los valores de cada eje: 3 talles x 2 colores son 6 filas', () => {
    const rows = buildMatrix([SIZE, COLOR], [], 'list-1');

    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.values.map((v) => v.value).join('/'))).toEqual([
      'S/Rojo',
      'S/Negro',
      'M/Rojo',
      'M/Negro',
      'L/Rojo',
      'L/Negro',
    ]);
  });

  it('sin ejes no hay matriz: un modelo que no varía es un producto suelto', () => {
    expect(buildMatrix([], [], 'list-1')).toEqual([]);
  });

  it('un eje sin valores elegidos no produce filas en vez de producir cero combinaciones raras', () => {
    expect(buildMatrix([SIZE, { ...COLOR, values: [] }], [], 'list-1')).toEqual([]);
  });

  it('las combinaciones nuevas nacen tildadas: destildar es la excepción', () => {
    const rows = buildMatrix([SIZE, COLOR], [], 'list-1');

    expect(rows.every((row) => row.selected)).toBe(true);
  });

  /*
   * El comportamiento que sostiene «agregar un talle es agregar variantes»: al recalcular, las
   * filas que ya existían conservan su producto y lo que el usuario había escrito.
   */
  it('conserva lo cargado al agregar un valor: sólo aparecen las filas nuevas', () => {
    const existing: ProductModelVariantDto[] = [
      {
        uuid: 'product-s-red',
        version: 3,
        sku: 'RB-S-RO-EDITADO',
        hasMovements: true,
        optionValues: [{ optionValueUuid: 's' }, { optionValueUuid: 'red' }],
        priceListEntries: [{ priceListUuid: 'list-1', price: 12000 }],
      },
    ];

    const rows = buildMatrix(
      [{ ...SIZE, values: [...SIZE.values, value('xl', 'XL', 'XL')] }, COLOR],
      existing,
      'list-1',
    );

    const kept = rows.find((row) => row.key === keyOf([value('s', 'S'), value('red', 'Rojo')]));
    expect(kept?.uuid).toBe('product-s-red');
    expect(kept?.version).toBe(3);
    expect(kept?.sku).toBe('RB-S-RO-EDITADO');
    expect(kept?.price).toBe(12000);
    expect(kept?.hasMovements).toBe(true);

    // Las dos combinaciones de XL son nuevas y no traen nada.
    const fresh = rows.filter((row) => row.values.some((v) => v.uuid === 'xl'));
    expect(fresh).toHaveLength(2);
    expect(fresh.every((row) => row.uuid === undefined)).toBe(true);
  });

  it('reencuentra la fila aunque los ejes lleguen en otro orden', () => {
    const existing: ProductModelVariantDto[] = [
      {
        uuid: 'product-m-black',
        // El backend puede devolver los valores en el orden de sus ejes, que no es el de la grilla.
        optionValues: [{ optionValueUuid: 'black' }, { optionValueUuid: 'm' }],
      },
    ];

    const rows = buildMatrix([SIZE, COLOR], existing, 'list-1');

    const match = rows.find((row) => row.key === keyOf([value('m', 'M'), value('black', 'Negro')]));
    expect(match?.uuid).toBe('product-m-black');
  });

  it('una variante destildada se recuerda destildada', () => {
    const existing: ProductModelVariantDto[] = [
      {
        selected: false,
        optionValues: [{ optionValueUuid: 'l' }, { optionValueUuid: 'red' }],
      },
    ];

    const rows = buildMatrix([SIZE, COLOR], existing, 'list-1');

    const dropped = rows.find((row) => row.key === keyOf([value('l', 'L'), value('red', 'Rojo')]));
    expect(dropped?.selected).toBe(false);
    expect(rows.filter((row) => row.selected)).toHaveLength(5);
  });

  it('sin lista de precios no inventa un precio', () => {
    const existing: ProductModelVariantDto[] = [
      {
        optionValues: [{ optionValueUuid: 's' }, { optionValueUuid: 'red' }],
        priceListEntries: [{ priceListUuid: 'list-1', price: 12000 }],
      },
    ];

    const rows = buildMatrix([SIZE, COLOR], existing, null);

    expect(rows.every((row) => row.price === null)).toBe(true);
  });
});
