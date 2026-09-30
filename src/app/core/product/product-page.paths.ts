/** La pantalla del catálogo de productos. */
export const PRODUCTS_PATH = '/panel/products';

/**
 * La ficha de un producto existente.
 *
 * Vive en `core` y no en la feature porque la necesita quien **no** es el catálogo: el histórico de
 * compras y ventas enlaza acá desde el indicador de una línea, y una feature no importa de otra. La
 * feature de productos la reexporta, así que la ruta sigue escrita una sola vez.
 *
 * **Exige `product.branch_assign`**, que es lo que guarda el área entera (ver `panel-areas.ts`): un
 * cajero que revisa una venta ve el indicador pero no el enlace, porque el suyo terminaría en la
 * pantalla de «sin permiso».
 */
export function productEditPath(uuid: string): string {
  return `${PRODUCTS_PATH}/${uuid}/edit`;
}
