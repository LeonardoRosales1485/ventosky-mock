export const PRICE_LISTS_PATHS = '/panel/price-lists';

/**
 * Los productos con su precio en una lista. Se llega desde «Ver precios» del listado: la lista es
 * el encabezado —nombre, principal, habilitada—, y los precios son lo que esa lista *dice*.
 */
export function priceListPricesPath(uuid: string): string {
  return `${PRICE_LISTS_PATHS}/${uuid}/prices`;
}

/*
 * Los dos destinos de la ficha del producto a los que lleva la pantalla de precios.
 *
 * Se escriben acá y no se importan de `products` porque una feature sólo depende de `core` y
 * `shared`: son strings, y duplicarlos cuesta menos que cruzar features (`products.paths.ts` ya
 * resuelve igual el camino inverso hacia los modelos).
 */

/** Ficha del producto abierta en su solapa Precios, que es donde el precio se cambia. */
export function productPricingPath(uuid: string): string {
  return `/panel/products/${uuid}/edit`;
}

/** Valor de `?tab=` con el que la ficha del producto abre directo en Precios. */
export const PRODUCT_PRICING_TAB = 'prices';

/** Evolución del precio del producto, la pantalla del gráfico. */
export function productPriceHistoryPath(uuid: string): string {
  return `/panel/products/${uuid}/price-history`;
}
