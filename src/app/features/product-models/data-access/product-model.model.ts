import { Permissions } from '../../../core/auth/permissions';
import { Versioned } from '../../../core/concurrency/version-conflict.model';
import { UuidNameRef } from '../../../core/http/api-refs';

/**
 * Un valor de un eje, como lo consume la matriz. Se declara acá y no se importa de
 * `product-options` por la misma razón que el precio: las features no se cruzan entre sí.
 */
export interface ProductModelOptionValue {
  uuid: string;
  value: string;
  code?: string | null;
  displayOrder?: number;
  variantsInUse?: number;
}

/** Un eje del catálogo de la empresa, con los valores que ofrece. */
export interface ProductModelAxisOption {
  uuid: string;
  name: string;
  displayOrder?: number;
  values?: ProductModelOptionValue[];
  valuesCount?: number;
}

/**
 * Un precio del producto en una lista (`ProductPriceListEntryDTO`).
 *
 * Se declara acá y no se importa de `products`: una feature sólo depende de `core` y `shared`, y el
 * contrato del backend es el mismo para las dos.
 */
export interface ProductModelPriceEntry {
  priceListUuid: string;
  price: number | null;
}

/** Una lista de precios como columna de la matriz. */
export interface ProductModelPriceList {
  uuid: string;
  name: string;
  isPrincipal?: boolean;
  isCost?: boolean;
}

/** Una categoría del árbol, aplanada con su sangría, para el selector de datos comunes. */
export interface ProductModelCategoryOption {
  uuid: string;
  name: string;
  depth: number;
}

/** Qué valor fija una variante en un eje: «Talle: M». Viaja plano porque sólo se escribe. */
export interface ProductVariantValueDto {
  optionValueUuid: string;
  optionUuid?: string;
  /** «Talle». */
  optionName?: string;
  /** «M». */
  value?: string;
  /** Sufijo del SKU y/o hex del chip. */
  code?: string | null;
}

/**
 * Un eje del modelo con los valores que **este** modelo usa.
 *
 * La distinción importa: «Talle» tiene S, M, L, XL en el catálogo de la empresa, pero esta remera
 * viene sólo en S, M, L. Lo elegido acá es lo que multiplica el producto cartesiano de la matriz.
 */
export interface ProductModelOptionDto {
  uuid?: string;
  option: UuidNameRef;
  displayOrder?: number;
  values: ProductModelOptionValue[];
}

/**
 * Una fila de la matriz: una combinación y el producto que la representa.
 *
 * `uuid` es el del **producto**, no el de una entidad propia: la variante es un producto (RN-11).
 * Sin él la fila es nueva y se crea al guardar.
 */
export interface ProductModelVariantDto {
  uuid?: string;
  version?: number;
  optionValues: ProductVariantValueDto[];
  /** `false` es «esta combinación no existe»: no se crea, y si existía se saca del catálogo. */
  selected?: boolean;
  name?: string;
  /** Vacío deja que el backend sugiera `<prefijo>-<code1>-<code2>`. Siempre editable. */
  sku?: string;
  barcode?: string | null;
  priceListEntries?: ProductModelPriceEntry[];
  /** Derivados, de sólo lectura. */
  totalStock?: number | null;
  /**
   * `true` si la variante ya se compró, se vendió o se ajustó. La grilla la muestra bloqueada para
   * borrar: lo que tiene historia se desactiva, no se elimina.
   */
  hasMovements?: boolean;
}

/**
 * Un modelo con sus ejes y su matriz.
 *
 * `priceFrom`, `priceTo` y `totalStock` son **sumas derivadas de las variantes y de sólo lectura**:
 * el modelo no cotiza ni tiene stock (RN-12).
 */
export interface ProductModelDto extends Versioned {
  uuid: string;
  name: string;
  skuPrefix?: string | null;
  description?: string | null;
  brand?: UuidNameRef | null;
  category?: UuidNameRef | null;
  unitMeasure?: string | null;
  taxRate?: number | null;
  options?: ProductModelOptionDto[];
  /**
   * Las sucursales donde se ofrecen las variantes. En la lectura es un **derivado**: aquellas
   * donde se ofrece alguna variante activa, porque la sucursal es del producto (RN-11) y el modelo
   * no tiene una columna propia.
   */
  branches?: UuidNameRef[];
  variants?: ProductModelVariantDto[];
  variantsCount?: number;
  priceFrom?: number | null;
  priceTo?: number | null;
  totalStock?: number | null;
}

export interface ProductModelSavePayload {
  uuid?: string;
  name: string;
  skuPrefix?: string | null;
  description?: string | null;
  brand?: { uuid: string } | null;
  category?: { uuid: string } | null;
  unitMeasure?: string | null;
  taxRate?: number | null;
  /** `undefined` deja los ejes como están; un modelo sin ejes se rechaza. */
  options?: ProductModelOptionDto[];
  /**
   * Las sucursales con las que **nacen** las variantes que se creen en este guardado. No toca las
   * que ya existen: las suyas se editan en la ficha del producto. `undefined` sin el permiso
   * `product.branch_assign`, que es un 403 si viaja igual.
   */
  branches?: { uuid: string }[];
  /** `undefined` no toca la matriz: permite renombrar el modelo sin reenviar 48 filas. */
  variants?: ProductModelVariantDto[];
  version?: number;
}

export const PRODUCT_BRANCH_ASSIGN_PERMISSION = Permissions.productBranchAssign;
