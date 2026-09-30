import { PRODUCTS_PATH } from '../../core/product/product-page.paths';

/** Alta de producto. */
export const PRODUCTS_NEW_PATH = `${PRODUCTS_PATH}/new`;

/** Evolución del precio del producto: se llega desde la solapa Precios de su formulario. */
export function productPriceHistoryPath(uuid: string): string {
  return `${PRODUCTS_PATH}/${uuid}/price-history`;
}

/**
 * Alta de un modelo de variantes. Se escribe acá y no se importa de `product-models` porque una
 * feature sólo depende de `core` y `shared`: es un string, y duplicarlo cuesta menos que cruzar
 * features.
 */
export const PRODUCT_MODEL_NEW_PATH = '/panel/product-models/new';

/**
 * Ficha del modelo de variantes. Es a donde lleva el botón editar de una fila `MODEL` del listado:
 * el modelo no se edita en el formulario de producto —no tiene precio, ni stock, ni código—, así que
 * su lápiz apunta a su propia pantalla, la de la matriz.
 */
export function productModelEditPath(uuid: string): string {
  return `/panel/product-models/${uuid}`;
}
