import { Versioned } from '../../../core/concurrency/version-conflict.model';

export interface UuidNameDto {
  uuid: string;
  name: string;
}

export interface UserRoleDto {
  uuid: string;
  name: string;
  status?: number;
  isDefault?: boolean;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

export interface UserCompanyRoleDto {
  uuid?: string;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
  companyUuid: string;
  companyName?: string | null;
  companyCuit?: string | null;
  roles: UserRoleDto[];
}

export interface UserPriceListDto {
  uuid: string;
  name: string;
  isPrincipal?: boolean;
  isActive?: boolean;
}

/** Payload / response shape for `UserDTO` from the backend. */
export interface UserDto extends Versioned {
  uuid: string;
  status: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated: string;
  username: string;
  email: string | null;
  phone: string | null;
  password?: string;
  userCompanyRoles: UserCompanyRoleDto[];
  priceList?: UserPriceListDto | null;
}

/** `version` —la leída al abrir el formulario, sin la cual el backend rechaza toda edición con
 * 409— entra por el `Partial<UserDto>`, igual que `uuid`. */
export type UserSavePayload = Partial<UserDto> & {
  username: string;
  email?: string | null;
  phone?: string | null;
  password?: string;
  userCompanyRoles?: UserCompanyRoleDto[];
};
