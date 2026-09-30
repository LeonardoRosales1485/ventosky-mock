import { describe, expect, it } from 'vitest';
import { PickerProduct } from '../../../../core/product-picker/product-picker.model';
import { axesOf, cellKey } from '../../../../core/product-picker/variant-selection';
import {
  ModelLoadCell,
  buildLoadGrid,
  columnTotal,
  gridTotal,
  linesOf,
  rowTotal,
} from './model-load-grid';

const SIZE = 'axis-size';
const COLOR = 'axis-color';

function variant(uuid: string, size: string, color: string): PickerProduct {
  return {
    uuid,
    name: `Remera ${size}/${color}`,
    variantValues: [
      { optionUuid: SIZE, optionName: 'Talle', optionValueUuid: `s-${size}`, value: size },
      { optionUuid: COLOR, optionName: 'Color', optionValueUuid: `c-${color}`, value: color },
    ],
  } as PickerProduct;
}

// La zapatería del wireframe, recortada: L no viene en rojo.
const VARIANTS = [
  variant('v1', 'S', 'Blanco'),
  variant('v2', 'S', 'Negro'),
  variant('v3', 'S', 'Rojo'),
  variant('v4', 'M', 'Blanco'),
  variant('v5', 'M', 'Negro'),
  variant('v6', 'M', 'Rojo'),
  variant('v7', 'L', 'Blanco'),
  variant('v8', 'L', 'Negro'),
];

const AXES = axesOf(VARIANTS);

function withQuantities(entries: [string, string, number][]): Map<string, ModelLoadCell> {
  const cells = buildLoadGrid(VARIANTS, AXES);
  for (const [size, color, quantity] of entries) {
    const key = cellKey(`s-${size}`, `c-${color}`);
    cells.set(key, { ...cells.get(key)!, quantity });
  }
  return cells;
}

describe('buildLoadGrid', () => {
  it('cruza los dos ejes: una celda por combinación posible', () => {
    const cells = buildLoadGrid(VARIANTS, AXES);

    expect(cells.size).toBe(9);
  });

  it('la combinación que el modelo no fabrica queda sin variante: la celda se apaga', () => {
    const cells = buildLoadGrid(VARIANTS, AXES);

    expect(cells.get(cellKey('s-L', 'c-Rojo'))?.variant).toBeNull();
    expect(cells.get(cellKey('s-L', 'c-Negro'))?.variant?.uuid).toBe('v8');
  });

  it('las celdas nacen vacías, no en cero: una compra no repone lo que el remito no trae', () => {
    const cells = buildLoadGrid(VARIANTS, AXES);

    expect([...cells.values()].every((cell) => cell.quantity === null)).toBe(true);
  });
});

describe('linesOf', () => {
  it('agrega una línea por celda con cantidad, y sólo por ésas', () => {
    const lines = linesOf(
      withQuantities([
        ['S', 'Blanco', 6],
        ['M', 'Negro', 8],
      ]),
    );

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.product.uuid).sort()).toEqual(['v1', 'v5']);
  });

  it('una celda en cero no es una línea: sería una línea que hay que borrar a mano', () => {
    expect(linesOf(withQuantities([['S', 'Blanco', 0]]))).toEqual([]);
  });

  it('una celda sin variante nunca produce línea, aunque tenga cantidad', () => {
    const cells = buildLoadGrid(VARIANTS, AXES);
    const key = cellKey('s-L', 'c-Rojo');
    cells.set(key, { ...cells.get(key)!, quantity: 5 });

    expect(linesOf(cells)).toEqual([]);
  });
});

describe('totales', () => {
  const cells = withQuantities([
    ['S', 'Blanco', 6],
    ['S', 'Negro', 6],
    ['S', 'Rojo', 4],
    ['M', 'Blanco', 8],
  ]);
  const colors = ['c-Blanco', 'c-Negro', 'c-Rojo'];
  const sizes = ['s-S', 's-M', 's-L'];

  it('el total de la fila es el control cruzado contra el remito', () => {
    expect(rowTotal(cells, 's-S', colors)).toBe(16);
    expect(rowTotal(cells, 's-M', colors)).toBe(8);
    expect(rowTotal(cells, 's-L', colors)).toBe(0);
  });

  it('el total de la columna cruza por el otro eje', () => {
    expect(columnTotal(cells, 'c-Blanco', sizes)).toBe(14);
    expect(columnTotal(cells, 'c-Rojo', sizes)).toBe(4);
  });

  it('el total de la grilla es lo que se compara con el remito', () => {
    expect(gridTotal(cells)).toBe(24);
  });
});
