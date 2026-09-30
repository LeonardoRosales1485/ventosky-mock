import { ProductChip } from '../../shared/components/product-chip/product-chip';

/**
 * En qué estado del catálogo quedó un producto que el histórico sigue nombrando
 * (`ProductCatalogState` del backend, desde `6.9.0`).
 *
 * Es la lectura de las dos operaciones del ADR 0001 —discontinuar y archivar— desde el lado de quien
 * abre una venta o una compra ya cerrada. La línea no guarda snapshot del nombre: resuelve el
 * producto vivo, así que el histórico siempre mostró bien **qué** se vendió; lo que faltaba era
 * poder saber que ese producto ya no está como estaba.
 *
 * **La ausencia de valor es un valor**, y es el caso más común: el producto que sigue en circulación
 * no lleva estado, y el que se dejó de comprar pero se sigue vendiendo para liquidar stock tampoco
 * —es un activo en liquidación, no mercadería retirada—.
 */
export const PRODUCT_CATALOG_STATES = ['DISCONTINUED', 'ARCHIVED'] as const;

export type ProductCatalogState = (typeof PRODUCT_CATALOG_STATES)[number];

/**
 * El estado que informa la línea, o `null` si no informa ninguno.
 *
 * Un valor que esta versión del front no conoce cae también en `null` y no en un chip genérico: la
 * línea se ve como se veía antes de que el campo existiera, que es preferible a marcar un producto
 * con una etiqueta que nadie sabe leer.
 */
export function toProductCatalogState(
  value: string | null | undefined,
): ProductCatalogState | null {
  return PRODUCT_CATALOG_STATES.find((state) => state === value) ?? null;
}

/**
 * El chip con el que la línea marca el estado, o `null` si no hay nada que marcar.
 *
 * Son **dos** chips y no uno porque discontinuar y archivar no son lo mismo: el discontinuado sigue
 * en el catálogo y se vuelve a habilitar desde su ficha, el archivado salió y no vuelve. Quien lee
 * un comprobante viejo tiene algo que hacer con el primero y nada que hacer con el segundo, así que
 * el chip que los agrupara le estaría escondiendo justo la diferencia que necesita.
 *
 * El discontinuado reusa la clave del catálogo —no una propia— porque es literalmente la misma
 * etiqueta: si alguien la reescribe, se reescribe en las dos pantallas a la vez.
 */
export function productCatalogStateChip(state: ProductCatalogState | null): ProductChip | null {
  if (state === 'ARCHIVED') {
    return { id: 'archived', labelKey: 'products.chips.archived' };
  }
  if (state === 'DISCONTINUED') {
    return { id: 'discontinued', labelKey: 'products.chips.discontinued' };
  }
  return null;
}
