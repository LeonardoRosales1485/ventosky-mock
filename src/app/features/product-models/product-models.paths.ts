import { PRODUCTS_PATH, productEditPath } from '../../core/product/product-page.paths';

/**
 * El listado de productos: **el modelo no tiene listado propio**. Sus filas viven en el catálogo
 * agrupado (§5.6, wireframe `1a`), así que es de ahí que se llega a la matriz y es ahí que vuelve
 * al guardar o cancelar.
 *
 * Se reexporta de `core` y ya no se duplica: la ruta dejó de ser patrimonio de la feature de
 * productos cuando el histórico de compras y ventas empezó a enlazar a la ficha.
 */
export { PRODUCTS_PATH };

/**
 * La ficha completa de una variante, que **es un producto** (RN-11): la matriz sirve para el alta
 * rápida, y todo lo demás —códigos, empaques, lotes, sucursales, precios por lista— vive en la
 * pantalla del producto.
 */
export function variantProductPath(uuid: string): string {
  return productEditPath(uuid);
}
