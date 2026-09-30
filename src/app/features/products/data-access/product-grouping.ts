import { ProductPaginateDto } from './product.model';

/**
 * Una fila del catálogo tal como la devuelve `POST /product/paginate-catalog`: **o** un modelo,
 * **o** un producto suelto.
 *
 * La unidad de la página es la fila del catálogo y no el producto. Es lo que arregla el defecto de
 * agrupar en el cliente: ahí un modelo de dieciséis variantes se partía entre páginas y se dibujaba
 * repetido en cada una, con cuatro variantes en la primera y doce en la siguiente.
 */
export interface ProductCatalogRowDto {
  rowType: 'MODEL' | 'PRODUCT';
  model?: CatalogModelDto | null;
  product?: ProductPaginateDto | null;
}

/** El modelo de una fila del catálogo, con sus derivados y sin ninguna columna propia (RN-12). */
export interface CatalogModelDto {
  uuid: string;
  name: string;
  skuPrefix?: string | null;
  brand?: { uuid: string; name: string } | null;
  category?: { uuid: string; name: string } | null;
  variantsCount?: number;
  /**
   * Rango de precios del modelo sobre **todas** sus variantes. El listado ya no lo dibuja —la
   * columna de precios se mudó a la pantalla por lista— pero sigue siendo parte del contrato de
   * `paginate-catalog`, así que se declara acá y no en la fila que se dibuja.
   */
  priceFrom?: number | null;
  priceTo?: number | null;
  totalStock?: number | null;
}

/**
 * Una fila dibujable de la tabla: el encabezado de un modelo, un producto —suelto, o variante
 * mostrada bajo su modelo cuando está expandido— o el pie que lleva al modelo cuando quedaron
 * variantes sin mostrar.
 */
export type ProductRow = ProductModelGroupRow | ProductLeafRow | ProductMoreVariantsRow;

export interface ProductModelGroupRow {
  kind: 'model';
  uuid: string;
  name: string;
  skuPrefix: string;
  brand?: string | null;
  category?: string | null;
  variantsCount: number;
  totalStock?: number | null;
  /** `true` mientras se piden las variantes al expandir. */
  loadingVariants: boolean;
}

export interface ProductLeafRow {
  kind: 'product';
  product: ProductPaginateDto;
  /** `true` cuando la fila cuelga de un modelo: la pantalla la sangra. */
  isVariant: boolean;
}

/**
 * El pie de un modelo expandido cuyas variantes no entraron todas: «…9 variantes más».
 *
 * No es un «ver más» que siga estirando la fila —dieciséis variantes desplegadas tapan la página
 * igual que antes de agrupar—: lleva a la ficha del modelo, que es la pantalla que existe para
 * verlas todas y además dejarlas editar.
 */
export interface ProductMoreVariantsRow {
  kind: 'moreVariants';
  /** El modelo que se abre al hacer click. */
  modelUuid: string;
  modelName: string;
  /** Cuántas quedaron sin dibujar. */
  hiddenCount: number;
}

/**
 * Cuántas variantes se dibujan bajo el modelo antes de derivar a su ficha.
 *
 * Expandir es para espiar de qué se trata el modelo, no para revisar las dieciséis: con la página
 * en diez filas, un modelo desplegado entero era la página entera.
 */
export const INLINE_VARIANTS_LIMIT = 5;

/**
 * Las filas dibujables de una página del catálogo, con las variantes ya cargadas de los modelos
 * expandidos.
 *
 * Las variantes se piden al expandir y viven fuera de la página —en `variantsByModel`—, porque son
 * dieciséis por modelo y la mayoría no se abre nunca. Se piden **todas** —quedarse con las que
 * cayeron en la página era el defecto original— pero se dibujan hasta
 * {@link INLINE_VARIANTS_LIMIT}: el resto se resume en una fila que lleva a la ficha del modelo.
 */
export function toRows(
  catalog: readonly ProductCatalogRowDto[],
  expanded: ReadonlySet<string>,
  variantsByModel: ReadonlyMap<string, readonly ProductPaginateDto[]>,
  loadingModels: ReadonlySet<string>,
): ProductRow[] {
  const rows: ProductRow[] = [];

  for (const entry of catalog) {
    if (entry.rowType === 'PRODUCT') {
      if (entry.product) {
        rows.push({ kind: 'product', product: entry.product, isVariant: false });
      }
      continue;
    }

    const model = entry.model;
    if (!model) {
      continue;
    }
    rows.push({
      kind: 'model',
      uuid: model.uuid,
      name: model.name,
      skuPrefix: model.skuPrefix ? `${model.skuPrefix}—` : '',
      brand: model.brand?.name ?? null,
      category: model.category?.name ?? null,
      variantsCount: model.variantsCount ?? 0,
      totalStock: model.totalStock ?? null,
      loadingVariants: loadingModels.has(model.uuid),
    });

    if (!expanded.has(model.uuid)) {
      continue;
    }
    const variants = variantsByModel.get(model.uuid) ?? [];
    for (const variant of variants.slice(0, INLINE_VARIANTS_LIMIT)) {
      rows.push({ kind: 'product', product: variant, isVariant: true });
    }

    const hiddenCount = variants.length - INLINE_VARIANTS_LIMIT;
    if (hiddenCount > 0) {
      rows.push({
        kind: 'moreVariants',
        modelUuid: model.uuid,
        modelName: model.name,
        hiddenCount,
      });
    }
  }

  return rows;
}

/** El precio más bajo y el más alto de las variantes de un modelo, para una lista de precios. */
export function priceRangeOf(
  variants: readonly ProductPaginateDto[],
  priceListUuid: string,
): { from: number; to: number } | null {
  const prices = variants
    .map(
      (variant) =>
        (variant.priceListEntries ?? []).find((entry) => entry.priceListUuid === priceListUuid)
          ?.price,
    )
    .filter((price): price is number => typeof price === 'number');

  if (prices.length === 0) {
    return null;
  }
  return { from: Math.min(...prices), to: Math.max(...prices) };
}
