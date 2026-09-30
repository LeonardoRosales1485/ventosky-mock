import { Permissions } from '../auth/permissions';
import { Versioned } from '../concurrency/version-conflict.model';

/** Payload / response shape for `BranchDTO` from the backend. */
export interface BranchDto extends Versioned {
  uuid: string;
  name: string;
  active: boolean;
  /**
   * Domicilio de la sucursal. Lo imprime el remito de traslado, que es el papel que acompaña la
   * mercadería: sin él, el remito dice entre qué sucursales viaja pero no a dónde hay que llegar.
   */
  address?: string | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

export interface BranchSavePayload {
  uuid?: string;
  name: string;
  active: boolean;
  /** Vacío se guarda como vacío: mandar la dirección en blanco es borrarla, no dejarla como está. */
  address: string | null;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}

export const BRANCH_VIEW_PERMISSION = Permissions.branchView;
export const BRANCH_CREATE_PERMISSION = Permissions.branchCreate;
export const BRANCH_EDIT_PERMISSION = Permissions.branchEdit;
export const BRANCH_DELETE_PERMISSION = Permissions.branchDelete;
