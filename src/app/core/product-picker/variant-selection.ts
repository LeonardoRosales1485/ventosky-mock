import { PickerProduct } from './product-picker.model';

/** Un eje del selector: «Talle» con sus chips. */
export interface VariantAxis {
  uuid: string;
  name: string;
  values: readonly VariantAxisValue[];
}

export interface VariantAxisValue {
  uuid: string;
  value: string;
  /** Hex del chip cuando el eje es un color; el selector lo usa como punto de muestra. */
  code?: string | null;
}

/**
 * Los ejes de un modelo, deducidos de las variantes que llegaron.
 *
 * Se deducen y no se piden: las variantes ya traen su combinación, así que abrir el selector cuesta
 * **una** consulta y no dos. El orden de los ejes y el de los valores es el del primer producto que
 * los nombra, que es el que el backend ya devolvió ordenado.
 */
export function axesOf(variants: readonly PickerProduct[]): VariantAxis[] {
  const axes = new Map<string, VariantAxis>();

  for (const variant of variants) {
    for (const value of variant.variantValues ?? []) {
      const axisUuid = value.optionUuid;
      const valueUuid = value.optionValueUuid;
      if (!axisUuid || !valueUuid) {
        continue;
      }
      const axis = axes.get(axisUuid) ?? {
        uuid: axisUuid,
        name: value.optionName ?? '',
        values: [] as VariantAxisValue[],
      };
      if (!axis.values.some((candidate) => candidate.uuid === valueUuid)) {
        axis.values = [...axis.values, { uuid: valueUuid, value: value.value ?? '', code: value.code }];
      }
      axes.set(axisUuid, axis);
    }
  }

  return [...axes.values()];
}

/**
 * La variante que fija exactamente esos valores, o `null` si la combinación no existe.
 *
 * «No existe» es un resultado normal y no un error: es el clásico «no viene en L rojo», y el
 * selector lo muestra en gris en vez de esconderlo, para que el operador vea que no se le escapó.
 */
export function variantFor(
  variants: readonly PickerProduct[],
  selection: ReadonlyMap<string, string>,
): PickerProduct | null {
  if (selection.size === 0) {
    return null;
  }
  return (
    variants.find((variant) => {
      const values = variant.variantValues ?? [];
      if (values.length !== selection.size) {
        return false;
      }
      return values.every(
        (value) => value.optionUuid && selection.get(value.optionUuid) === value.optionValueUuid,
      );
    }) ?? null
  );
}

/**
 * El stock de cada combinación de los dos primeros ejes: la grilla que el operador mira para ver
 * de una si conviene ofrecer otro color.
 *
 * Con un solo eje la grilla es una fila; con tres o más se arma sobre los dos primeros y el resto
 * queda fijado por los chips, que es lo que evita dibujar un cubo en una pantalla.
 */
export function stockGrid(
  variants: readonly PickerProduct[],
  axes: readonly VariantAxis[],
  selection: ReadonlyMap<string, string>,
): { rows: VariantAxisValue[]; columns: VariantAxisValue[]; stock: Map<string, number | null> } {
  const [rowAxis, columnAxis] = axes;
  const rows = rowAxis ? [...rowAxis.values] : [];
  const columns = columnAxis ? [...columnAxis.values] : [];
  const stock = new Map<string, number | null>();

  for (const variant of variants) {
    if (!matchesFixedAxes(variant, axes, selection)) {
      continue;
    }
    const rowValue = valueOfAxis(variant, rowAxis?.uuid);
    const columnValue = columnAxis ? valueOfAxis(variant, columnAxis.uuid) : '';
    if (rowValue === null || columnValue === null) {
      continue;
    }
    stock.set(cellKey(rowValue, columnValue), variant.totalStock ?? null);
  }

  return { rows, columns, stock };
}

/**
 * Los ejes que la grilla **no** dibuja (el tercero en adelante) tienen que coincidir con lo que los
 * chips fijaron: si no, la grilla mostraría el stock de una capacidad que el operador no eligió.
 */
function matchesFixedAxes(
  variant: PickerProduct,
  axes: readonly VariantAxis[],
  selection: ReadonlyMap<string, string>,
): boolean {
  return axes.slice(2).every((axis) => {
    const chosen = selection.get(axis.uuid);
    return !chosen || valueOfAxis(variant, axis.uuid) === chosen;
  });
}

function valueOfAxis(variant: PickerProduct, axisUuid: string | undefined): string | null {
  if (!axisUuid) {
    return '';
  }
  const value = (variant.variantValues ?? []).find((candidate) => candidate.optionUuid === axisUuid);
  return value?.optionValueUuid ?? null;
}

export function cellKey(rowValueUuid: string, columnValueUuid: string): string {
  return `${rowValueUuid}|${columnValueUuid}`;
}

/** «M / Rojo»: cómo se nombra la combinación elegida en el pie del selector. */
export function combinationLabel(variant: PickerProduct): string {
  return (variant.variantValues ?? [])
    .map((value) => value.value)
    .filter((value): value is string => !!value)
    .join(' / ');
}
