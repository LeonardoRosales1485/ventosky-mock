import { PickerProduct } from '../../../../core/product-picker/product-picker.model';
import { VariantAxis, cellKey } from '../../../../core/product-picker/variant-selection';

/** Una celda de la grilla: la variante que cruza esa fila con esa columna, y cuánto se pide. */
export interface ModelLoadCell {
  /** `null` cuando el modelo no fabrica esa combinación: la celda se muestra apagada. */
  variant: PickerProduct | null;
  quantity: number | null;
}

/** Lo que se agrega a la compra: una línea por celda con cantidad. */
export interface ModelLoadLine {
  product: PickerProduct;
  quantity: number;
}

/**
 * La grilla de reposición: las variantes cruzadas en dos ejes, con una cantidad por celda.
 *
 * Es exactamente **como llega el remito del proveedor** —seis negros del 40, cuatro del 41—, y por
 * eso se carga en una sola pasada en vez de buscar el producto doce veces (§5.6, wireframe `1p`).
 */
export function buildLoadGrid(
  variants: readonly PickerProduct[],
  axes: readonly VariantAxis[],
): Map<string, ModelLoadCell> {
  const cells = new Map<string, ModelLoadCell>();
  const [rowAxis, columnAxis] = axes;
  if (!rowAxis) {
    return cells;
  }

  for (const row of rowAxis.values) {
    const columns = columnAxis ? columnAxis.values : [{ uuid: '', value: '' }];
    for (const column of columns) {
      const variant = findVariant(variants, rowAxis.uuid, row.uuid, columnAxis?.uuid, column.uuid);
      cells.set(cellKey(row.uuid, column.uuid), { variant, quantity: null });
    }
  }
  return cells;
}

function findVariant(
  variants: readonly PickerProduct[],
  rowAxisUuid: string,
  rowValueUuid: string,
  columnAxisUuid: string | undefined,
  columnValueUuid: string,
): PickerProduct | null {
  return (
    variants.find((variant) => {
      const values = variant.variantValues ?? [];
      const matchesRow = values.some(
        (value) => value.optionUuid === rowAxisUuid && value.optionValueUuid === rowValueUuid,
      );
      if (!matchesRow) {
        return false;
      }
      if (!columnAxisUuid) {
        return true;
      }
      return values.some(
        (value) => value.optionUuid === columnAxisUuid && value.optionValueUuid === columnValueUuid,
      );
    }) ?? null
  );
}

/**
 * Las líneas que la grilla va a agregar: sólo las celdas con cantidad.
 *
 * Una celda vacía no es una línea con cero: es una combinación que este remito no trae, y agregarla
 * en cero llenaría la compra de líneas que hay que borrar a mano.
 */
export function linesOf(cells: ReadonlyMap<string, ModelLoadCell>): ModelLoadLine[] {
  const lines: ModelLoadLine[] = [];
  for (const cell of cells.values()) {
    if (cell.variant && cell.quantity != null && cell.quantity > 0) {
      lines.push({ product: cell.variant, quantity: cell.quantity });
    }
  }
  return lines;
}

/** El total de una fila. Es el control cruzado contra el remito, junto con el de la columna. */
export function rowTotal(
  cells: ReadonlyMap<string, ModelLoadCell>,
  rowValueUuid: string,
  columnValueUuids: readonly string[],
): number {
  return columnValueUuids.reduce(
    (total, columnUuid) => total + (cells.get(cellKey(rowValueUuid, columnUuid))?.quantity ?? 0),
    0,
  );
}

export function columnTotal(
  cells: ReadonlyMap<string, ModelLoadCell>,
  columnValueUuid: string,
  rowValueUuids: readonly string[],
): number {
  return rowValueUuids.reduce(
    (total, rowUuid) => total + (cells.get(cellKey(rowUuid, columnValueUuid))?.quantity ?? 0),
    0,
  );
}

/** Cuántas unidades suma la grilla entera: el número que se compara con el remito. */
export function gridTotal(cells: ReadonlyMap<string, ModelLoadCell>): number {
  let total = 0;
  for (const cell of cells.values()) {
    total += cell.quantity ?? 0;
  }
  return total;
}
