import { Permissions } from '../auth/permissions';
import { UuidNameRef } from '../http/api-refs';

/**
 * La caja y su sesión, tal como las informa el backend.
 *
 * Vive en `core/` porque toda operación —compra o venta— se imputa a una sesión de caja: el commit
 * la resuelve con la caja más la fecha de operación, y sin una sesión que cubra ese instante la
 * rechaza. No hay nada de mostrador acá.
 */

/** Estado que informa el backend en `openSession.sessionState`. */
export const SESSION_STATE_OPEN = 'OPEN';

/** Sesión de caja (`CashRegisterSessionPaginateDTO`). El listado sólo trae la abierta, si hay. */
export interface CashSessionDto {
  uuid: string;
  sessionState?: string | null;
  openedAt?: string | null;
  openingAmount?: number | null;
  openedBy?: UuidNameRef | null;
  closedBy?: UuidNameRef | null;
}

/** Caja de la empresa (`CashRegisterPaginateDTO`). */
export interface CashRegisterDto {
  uuid: string;
  name: string;
  active?: boolean | null;
  branch?: UuidNameRef | null;
  /** Sólo presente mientras la caja arrastra una sesión `OPEN`. */
  openSession?: CashSessionDto | null;
}

/** `CashRegisterEntryContextDTO.resolution`. */
export type CashRegisterResolution = 'PREASSIGNED' | 'NONE';

/**
 * A qué caja entrar, resuelto por el backend (`GET /cash-register/entry-context`) a partir de la
 * preasignación del usuario en la sucursal activa. La regla vive del lado del servidor: el front
 * obedece la respuesta.
 */
export interface CashRegisterEntryContextDto {
  /** Caja preasignada con su `openSession`, o `null` si la tiene que elegir el usuario. */
  cashRegister?: CashRegisterDto | null;
  /** `true` → usar `cashRegister` sin preguntar cuál. */
  autoEnter?: boolean | null;
  /** `true` → la caja no tiene sesión OPEN y hace falta abrirla con el monto inicial. */
  requiresOpeningAmount?: boolean | null;
  /** `true` → la caja preasignada ya está abierta; no hay que llamar a `open`. */
  alreadyInSession?: boolean | null;
  resolution?: CashRegisterResolution | string | null;
}

export function hasOpenSession(cashRegister: CashRegisterDto | null): boolean {
  return cashRegister?.openSession?.sessionState === SESSION_STATE_OPEN;
}

/**
 * Quién tiene la caja abierta, para el rótulo de la sesión activa. Es informativo: no hay membresía
 * y cualquier usuario autorizado opera sobre una sesión abierta por otro.
 */
export function openedByName(cashRegister: CashRegisterDto | null): string | null {
  return cashRegister?.openSession?.openedBy?.name ?? null;
}

/**
 * Las cajas de la sucursal activa.
 *
 * `POST /cash-register/paginate` devuelve las de **toda la empresa** —a diferencia de los
 * depósitos—, pero una operación se imputa a una caja de la sucursal del request: el backend
 * resuelve el `X-Cash-Register-Uuid` contra ella y rechaza la que no le pertenezca. Ofrecer una
 * caja de otra sucursal sería ofrecer un 400, y además la elección se recuerda por sucursal.
 *
 * Una caja sin sucursal declarada no debería existir —el backend la exige al guardar— y ante la
 * duda se conserva: esconderla podría dejar la pantalla sin ninguna caja que elegir.
 */
export function branchCashRegisters(
  cashRegisters: readonly CashRegisterDto[],
  branchUuid: string | null,
): CashRegisterDto[] {
  if (!branchUuid) {
    return [...cashRegisters];
  }

  return cashRegisters.filter(
    (register) => !register.branch?.uuid || register.branch.uuid === branchUuid,
  );
}

/** Permiso que exige `POST /cash-register/{uuid}/open`. */
export const CASH_REGISTER_OPEN_PERMISSION = Permissions.cashRegisterOpen;

/**
 * La misma lista de cajas, con la sesión recién abierta puesta en la que corresponde.
 *
 * Reflejar una apertura no justifica releer el catálogo entero: lo único que cambió es el
 * `openSession` de esa caja, que es exactamente lo que miran `hasOpenSession` y el chip.
 */
export function withOpenSession(
  cashRegisters: readonly CashRegisterDto[],
  cashRegisterUuid: string,
  session: CashSessionDto,
): CashRegisterDto[] {
  return cashRegisters.map((register) =>
    register.uuid === cashRegisterUuid ? { ...register, openSession: session } : register,
  );
}
