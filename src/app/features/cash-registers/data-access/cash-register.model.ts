import { Permissions } from '../../../core/auth/permissions';
import { Versioned } from '../../../core/concurrency/version-conflict.model';

/** `UuidNameDTO` del backend: la referencia mínima con la que viajan sucursal y usuarios. */
export interface UuidNameRef {
  uuid: string;
  name: string;
}

/** Estado de sesión que informa el backend en `openSession.sessionState`. */
export const SESSION_STATE_OPEN = 'OPEN';

/**
 * Sesión de caja (`CashRegisterSessionPaginateDTO`). El listado sólo trae la **abierta**, si hay:
 * el ABM no muestra el histórico, únicamente si la caja está en uso ahora mismo.
 */
export interface CashRegisterSessionDto {
  uuid: string;
  sessionState?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
  openingAmount?: number | null;
  openedBy?: UuidNameRef | null;
  closedBy?: UuidNameRef | null;
}

/** Fila de `POST /cash-register/paginate` (`CashRegisterPaginateDTO`). */
export interface CashRegisterDto extends Versioned {
  uuid: string;
  name: string;
  active?: boolean | null;
  /** Sucursal dueña de la caja. El backend la exige: una caja siempre pertenece a una. */
  branch?: UuidNameRef | null;
  /** Sólo presente mientras la caja tiene una sesión `OPEN`. */
  openSession?: CashRegisterSessionDto | null;
  /** Usuarios con esta caja preasignada ("caja preferencial"). */
  assignedUsers?: UuidNameRef[] | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

/**
 * Body de `POST /cash-register/save`.
 *
 * `assignedUsers` es un update parcial del lado del backend: omitirlo **no toca** las
 * preasignaciones y `[]` las quita todas. El diálogo siempre manda la lista completa, así que
 * acá va siempre presente —incluso vacía— para que quitar el último usuario tenga efecto.
 */
export interface CashRegisterSavePayload {
  uuid?: string;
  name: string;
  active: boolean;
  branch: { uuid: string };
  assignedUsers: { uuid: string }[];
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}

/** Opción del select de usuarios a preasignar (`/user/paginate` sólo informa `username`). */
export interface CashRegisterUserOption {
  uuid: string;
  username: string;
}

export const CASH_REGISTER_VIEW_PERMISSION = Permissions.cashRegisterView;
export const CASH_REGISTER_CREATE_PERMISSION = Permissions.cashRegisterCreate;
export const CASH_REGISTER_EDIT_PERMISSION = Permissions.cashRegisterEdit;
export const CASH_REGISTER_DELETE_PERMISSION = Permissions.cashRegisterDelete;
/**
 * El permiso de apertura lo declara `core/cash-session`, que es donde vive la acción: el ABM la
 * ofrece, pero también el mostrador de ventas y el alta de compras.
 */
export { CASH_REGISTER_OPEN_PERMISSION } from '../../../core/cash-session/cash-session.model';

/** Una caja está en uso mientras arrastre una sesión `OPEN`: borrarla se lleva puesta la sesión. */
export function hasOpenSession(cashRegister: CashRegisterDto): boolean {
  return cashRegister.openSession?.sessionState === SESSION_STATE_OPEN;
}
