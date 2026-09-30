import { describe, expect, it } from 'vitest';
import { PickerProduct } from './product-picker.model';
import { axesOf, cellKey, combinationLabel, stockGrid, variantFor } from './variant-selection';

const SIZE = 'axis-size';
const COLOR = 'axis-color';

function variant(uuid: string, size: string, color: string, stock: number | null): PickerProduct {
  return {
    uuid,
    name: `Remera ${size}/${color}`,
    totalStock: stock,
    model: { uuid: 'model-tee', name: 'Remera Básica Algodón' },
    variantValues: [
      { optionUuid: SIZE, optionName: 'Talle', optionValueUuid: `s-${size}`, value: size },
      { optionUuid: COLOR, optionName: 'Color', optionValueUuid: `c-${color}`, value: color },
    ],
  } as PickerProduct;
}

const VARIANTS = [
  variant('v1', 'S', 'Blanco', 6),
  variant('v2', 'S', 'Negro', 7),
  variant('v3', 'M', 'Blanco', 3),
  variant('v4', 'M', 'Negro', 9),
  variant('v5', 'L', 'Blanco', 5),
];

describe('axesOf', () => {
  it('deduce los ejes de las variantes: abrir el selector cuesta una consulta, no dos', () => {
    const axes = axesOf(VARIANTS);

    expect(axes.map((axis) => axis.name)).toEqual(['Talle', 'Color']);
    expect(axes[0].values.map((value) => value.value)).toEqual(['S', 'M', 'L']);
    expect(axes[1].values.map((value) => value.value)).toEqual(['Blanco', 'Negro']);
  });

  it('no repite un valor que usan varias variantes', () => {
    expect(axesOf(VARIANTS)[1].values).toHaveLength(2);
  });

  it('un producto sin combinación no aporta ejes', () => {
    expect(axesOf([{ uuid: 'p1', name: 'Suelto' } as PickerProduct])).toEqual([]);
  });
});

describe('variantFor', () => {
  it('resuelve la variante que fija exactamente esos valores', () => {
    const selection = new Map([
      [SIZE, 's-M'],
      [COLOR, 'c-Negro'],
    ]);

    expect(variantFor(VARIANTS, selection)?.uuid).toBe('v4');
  });

  it('una combinación que no se fabrica devuelve null, que es un resultado normal', () => {
    const selection = new Map([
      [SIZE, 's-L'],
      [COLOR, 'c-Negro'],
    ]);

    expect(variantFor(VARIANTS, selection)).toBeNull();
  });

  it('sin elegir todos los ejes todavía no hay variante', () => {
    expect(variantFor(VARIANTS, new Map([[SIZE, 's-M']]))).toBeNull();
  });
});

describe('stockGrid', () => {
  it('cruza los dos primeros ejes con el stock de cada combinación', () => {
    const axes = axesOf(VARIANTS);
    const grid = stockGrid(VARIANTS, axes, new Map());

    expect(grid.rows.map((row) => row.value)).toEqual(['S', 'M', 'L']);
    expect(grid.columns.map((column) => column.value)).toEqual(['Blanco', 'Negro']);
    expect(grid.stock.get(cellKey('s-M', 'c-Negro'))).toBe(9);
    expect(grid.stock.get(cellKey('s-S', 'c-Blanco'))).toBe(6);
  });

  it('la combinación que no existe no tiene celda: la pantalla la muestra apagada', () => {
    const grid = stockGrid(VARIANTS, axesOf(VARIANTS), new Map());

    expect(grid.stock.has(cellKey('s-L', 'c-Negro'))).toBe(false);
  });

  it('con un solo eje la grilla es una columna vacía y una fila por valor', () => {
    const single = [
      {
        uuid: 'p1',
        name: '128 GB',
        totalStock: 4,
        variantValues: [
          { optionUuid: 'axis-cap', optionName: 'Capacidad', optionValueUuid: 'c-128', value: '128 GB' },
        ],
      } as PickerProduct,
    ];

    const grid = stockGrid(single, axesOf(single), new Map());

    expect(grid.rows).toHaveLength(1);
    expect(grid.columns).toHaveLength(0);
    expect(grid.stock.get(cellKey('c-128', ''))).toBe(4);
  });
});

describe('combinationLabel', () => {
  it('nombra la combinación como el selector la muestra', () => {
    expect(combinationLabel(VARIANTS[3])).toBe('M / Negro');
  });
});
