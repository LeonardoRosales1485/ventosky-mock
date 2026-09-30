import { Versioned } from '../../../core/concurrency/version-conflict.model';

/** Nested permission shape from `PermissionDTO`. */
export interface PermissionDto {
  uuid: string;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
  name: string;
  description?: string | null;
}

/** Payload / response shape for `RoleDTO` from the backend. */
export interface RoleDto extends Versioned {
  uuid: string;
  status: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated: string;
  name: string;
  /** Backend uses `0 | 1`, not boolean. */
  isDefault?: number;
  /** Present on get/save; omitted on paginate rows. */
  permissions?: PermissionDto[];
}

export interface RoleSavePayload {
  uuid?: string;
  name: string;
  isDefault?: number;
  permissions?: Pick<PermissionDto, 'uuid'>[];
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}
