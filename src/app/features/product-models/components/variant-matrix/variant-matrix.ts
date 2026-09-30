import {
  ProductModelOptionValue,
  ProductModelVariantDto,
} from '../../data-access/product-model.model';

/** Un eje de la grilla: el nombre de la columna y los valores que este modelo usa de él. */
export interface MatrixAxis {
  axisUuid: string;
  axisName: string;
  values: readonly ProductModelOptionValue[];
}

/** Una fila de la matriz: una combinación concreta y lo que se va a guardar de ella. */
export interface MatrixRow {
  /** Uuid del **producto** cuando la variante ya existe; ausente en una combinación nueva. */
  uuid?: string;
  version?: number;
  /** Un valor por eje, en el orden de las columnas. */
  values: readonly ProductModelOptionValue[];
  /** La clave con la que se reencuentra la fila al recalcular: los uuid ordenados. */
  key: string;
  selected: boolean;
  name?: string;
  sku?: string;
  barcode?: string | null;
  price: number | null;
  totalStock?: number | null;
  /** `true` si la variante ya se movió: se muestra bloqueada, sólo se puede desactivar. */
  hasMovements?: boolean;
}

/**
 * El producto cartesiano de los valores elegidos, conservando lo que ya estaba cargado.
 *
 * Es la operación central de la pantalla (§5.4): tres talles por dos colores son seis filas, y
 * agregar un cuarto talle agrega dos filas **sin tocar** las seis que el usuario ya completó. Lo que
 * hace posible eso es la clave de la combinación: una fila existente se reencuentra por los valores
 * que fija, no por su posición en la grilla, que cambia cada vez que se agrega un valor.
 *
 * Sin ejes no hay matriz: un modelo que no varía es un producto suelto, y devolver una fila vacía
 * sería ofrecer crear un producto desde la pantalla equivocada.
 */
export function buildMatrix(
  axes: readonly MatrixAxis[],
  existing: readonly ProductModelVariantDto[],
  priceListUuid: string | null,
): MatrixRow[] {
  if (axes.length === 0 || axes.some((axis) => axis.values.length === 0)) {
    return [];
  }

  const byKey = indexExisting(existing, priceListUuid);
  return cartesian(axes).map((values) => {
    const key = keyOf(values);
    const previous = byKey.get(key);
    return {
      uuid: previous?.uuid,
      version: previous?.version,
      values,
      key,
      // Una combinación nueva nace tildada: el caso normal es que el modelo venga en todas, y
      // destildar «no viene en L rojo» es la excepción.
      selected: previous?.selected ?? true,
      name: previous?.name,
      sku: previous?.sku ?? '',
      barcode: previous?.barcode ?? '',
      price: previous?.price ?? null,
      totalStock: previous?.totalStock,
      hasMovements: previous?.hasMovements ?? false,
    };
  });
}

interface ExistingRow {
  uuid?: string;
  version?: number;
  selected: boolean;
  name?: string;
  sku?: string;
  barcode?: string | null;
  price: number | null;
  totalStock?: number | null;
  hasMovements?: boolean;
}

function indexExisting(
  existing: readonly ProductModelVariantDto[],
  priceListUuid: string | null,
): Map<string, ExistingRow> {
  const byKey = new Map<string, ExistingRow>();
  for (const variant of existing) {
    const uuids = (variant.optionValues ?? [])
      .map((value) => value.optionValueUuid)
      .filter((uuid): uuid is string => !!uuid);
    if (uuids.length === 0) {
      continue;
    }
    byKey.set(keyOfUuids(uuids), {
      uuid: variant.uuid,
      version: variant.version,
      selected: variant.selected !== false,
      name: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      price: priceOf(variant, priceListUuid),
      totalStock: variant.totalStock,
      hasMovements: variant.hasMovements,
    });
  }
  return byKey;
}

/**
 * El precio de la lista que edita la grilla. La grilla muestra **una** columna de precio —la lista
 * principal—: el resto de las listas se editan en la ficha del producto, que es donde vive el precio
 * de verdad (RN-19).
 */
function priceOf(variant: ProductModelVariantDto, priceListUuid: string | null): number | null {
  if (!priceListUuid) {
    return null;
  }
  const entry = (variant.priceListEntries ?? []).find(
    (candidate) => candidate.priceListUuid === priceListUuid,
  );
  return entry?.price ?? null;
}

/** Las combinaciones, en el orden de los ejes: el primero varía más lento, como en la grilla. */
function cartesian(axes: readonly MatrixAxis[]): ProductModelOptionValue[][] {
  let combinations: ProductModelOptionValue[][] = [[]];
  for (const axis of axes) {
    const next: ProductModelOptionValue[][] = [];
    for (const combination of combinations) {
      for (const value of axis.values) {
        next.push([...combination, value]);
      }
    }
    combinations = next;
  }
  return combinations;
}

/**
 * La clave de una combinación: los uuid **ordenados**, para que la misma combinación dé la misma
 * clave aunque los ejes se reordenen. Es el mismo criterio que `variant_key` en el backend.
 */
export function keyOf(values: readonly ProductModelOptionValue[]): string {
  return keyOfUuids(values.map((value) => value.uuid));
}

function keyOfUuids(uuids: readonly string[]): string {
  return [...uuids].sort().join('|');
}
