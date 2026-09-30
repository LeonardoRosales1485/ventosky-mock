import { Permissions } from '../../../core/auth/permissions';
import { UuidNameRef } from '../../../core/http/api-refs';

/**
 * Precio del producto en una lista (`ProductPriceListEntryDTO`).
 *
 * El backend sólo emite una entrada por lista que **cotiza** el producto en la sucursal activa, y
 * nunca la de costo: que falte la entrada es «sin precio en esta lista», que no es lo mismo que cero.
 */
export interface PriceListProductEntryDto {
  priceListUuid: string;
  price: number | null;
}

/**
 * Fila de `POST /product/paginate-all` acotada a lo que la pantalla de precios de una lista dibuja.
 *
 * Es un DTO propio y no el del catálogo de productos porque las features no se importan entre sí:
 * acá no hay stock, ni ejes, ni modelo —la pantalla es producto y precio—, así que copiar los seis
 * campos que sí se usan cuesta menos que arrastrar el contrato entero del otro listado.
 */
export interface PriceListProductDto {
  uuid: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  brand?: UuidNameRef | null;
  category?: UuidNameRef | null;
  /** `ProductType` del backend: qué es el producto ({@link PRODUCT_TYPES}). */
  type?: string | null;
  priceListEntries?: PriceListProductEntryDto[] | null;
  status?: number;
}

/** Los tipos de producto, como los nombra el enum `ProductType` del backend. */
export const PRODUCT_TYPES = ['SIMPLE', 'KIT', 'SERVICE'] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

/**
 * El paginado que alimenta la pantalla es `/product/paginate-all` —el catálogo completo de la
 * empresa—, que exige `product.branch_assign` y no `product.view`: sin ese permiso la pantalla
 * responde 403, así que es el que decide si «Ver precios» se ofrece.
 */
export const PRODUCT_CATALOG_VIEW_PERMISSION = Permissions.productBranchAssign;

/** El precio se edita en la ficha del producto; sin `product.edit` el atajo no se dibuja. */
export const PRODUCT_EDIT_PERMISSION = Permissions.productEdit;

/** El historial vive en su propia pantalla y exige `price_history.view`. */
export const PRICE_HISTORY_VIEW_PERMISSION = Permissions.priceHistoryView;

/** Precio del producto en `priceListUuid`, o `null` cuando la lista no lo cotiza. */
export function priceFor(product: PriceListProductDto, priceListUuid: string): number | null {
  const entry = product.priceListEntries?.find((item) => item.priceListUuid === priceListUuid);
  return entry?.price ?? null;
}
