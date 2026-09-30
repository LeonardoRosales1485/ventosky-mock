import { Permissions } from '../../../core/auth/permissions';
import { Versioned } from '../../../core/concurrency/version-conflict.model';

/**
 * Fila de `POST /price-list/paginate` (`PriceListPaginateDTO`).
 *
 * El paginado devuelve sólo el encabezado: el mapper del backend no vuelca `prices`, y el detalle
 * (`GET /price-list/uuid/{uuid}`) tampoco. Los precios de un producto se cargan desde el producto,
 * que es donde el backend los expone (`priceListEntries`), no desde acá.
 */
export interface PriceListDto extends Versioned {
  uuid: string;
  name: string;
  isPrincipal?: boolean | null;
  isActive?: boolean | null;
  /**
   * Lista reservada del costo de compra. La administra el sistema desde las entradas de stock: no se
   * edita, no se elimina y no puede ser destino de una regla de precio.
   */
  isCost?: boolean | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

/**
 * Body de `POST /price-list/save`.
 *
 * `isCost` nunca viaja: mandarlo en `true` es un 403 y el backend no lo mapea de todos modos.
 * `isPrincipal` se envía siempre con el valor vigente —cambiarlo es exclusivo de SysAdmin, y el
 * backend sólo valida cuando el valor difiere del persistido—.
 */
export interface PriceListSavePayload {
  uuid?: string;
  name: string;
  isPrincipal: boolean;
  isActive: boolean;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}

export const PRICE_LIST_VIEW_PERMISSION = Permissions.priceListView;
export const PRICE_LIST_CREATE_PERMISSION = Permissions.priceListCreate;
export const PRICE_LIST_EDIT_PERMISSION = Permissions.priceListEdit;
export const PRICE_LIST_DELETE_PERMISSION = Permissions.priceListDelete;

/** La lista de costo es de escritura exclusiva del sistema: no admite edición ni baja. */
export function isSystemManaged(priceList: PriceListDto): boolean {
  return priceList.isCost === true;
}
