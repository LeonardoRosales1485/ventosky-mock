import { Permissions } from '../auth/permissions';
import { Versioned } from '../concurrency/version-conflict.model';

/** Row / response of `WarehouseDTO`. */
export interface WarehouseDto extends Versioned {
  uuid: string;
  name: string;
  /**
   * Orden de descuento dentro de la sucursal: 1 es el primero que se vacía. Lo usa la política
   * `MANUAL_PRIORITY` de la sucursal; el backend lo autoasigna como `max + 1` al crear el depósito.
   */
  priority?: number | null;
  /** Sucursal dueña del depósito. El paginado ya viene acotado a la sucursal activa. */
  branch?: { uuid: string; name: string } | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

/**
 * Body of `POST /warehouse/save`.
 *
 * Sin `branch` el backend usa la del header `X-Branch-Uuid` en el alta y conserva la que ya tenía
 * en la edición, que es justo lo que hace falta: la pantalla trabaja siempre sobre la sucursal
 * activa. `priority` nulo también es intencional —el backend lo autoasigna al final de la cola—.
 */
export interface WarehouseSavePayload {
  uuid?: string;
  name: string;
  priority: number | null;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}

export const WAREHOUSE_VIEW_PERMISSION = Permissions.warehouseView;
export const WAREHOUSE_CREATE_PERMISSION = Permissions.warehouseCreate;
export const WAREHOUSE_EDIT_PERMISSION = Permissions.warehouseEdit;
export const WAREHOUSE_DELETE_PERMISSION = Permissions.warehouseDelete;
