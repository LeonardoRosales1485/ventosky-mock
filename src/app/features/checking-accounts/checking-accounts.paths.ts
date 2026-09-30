/**
 * El listado de cuentas corrientes: una fila por cuenta, con saldo, vencido, nivel de morosidad y
 * disponible. Es el plural, así que consulta; no registra nada.
 */
export const CHECKING_ACCOUNTS_PATH = '/panel/checking-accounts';

/**
 * El estado de cuenta de un titular. Cuelga del listado porque se llega desde su fila, y exige un
 * `uuid`, así que no es un destino al que el buscador global pueda mandar.
 */
export function checkingAccountPath(uuid: string): string {
  return `${CHECKING_ACCOUNTS_PATH}/${uuid}`;
}

/**
 * El alta de un cobro o un pago de cuenta corriente: la pantalla que **registra** la operación.
 *
 * Sigue el reparto que ya hacen `/panel/pos` y `/panel/sales`: la ruta de alta nombra la acción y el
 * plural —{@link COLLECTIONS_PATH}— queda para el listado de lo ya registrado.
 */
export const NEW_COLLECTION_PATH = '/panel/new-collection';

/** El listado de cobros y pagos, con su estado de imputación. Desde acá se imputa y se anula. */
export const COLLECTIONS_PATH = '/panel/collections';

/** El alta con el titular ya elegido: es a dónde lleva «Registrar cobro» desde una fila. */
export function newCollectionForAccountPath(accountUuid: string): string {
  return `${NEW_COLLECTION_PATH}?account=${encodeURIComponent(accountUuid)}`;
}

/**
 * La política de cuenta corriente de la empresa.
 *
 * Cuelga de `settings` y no del listado porque no es una consulta de operación: se configura una vez
 * y rige para todos los titulares.
 */
export const CHECKING_ACCOUNT_POLICY_PATH = '/panel/settings/checking-accounts';

/**
 * Las diferencias entre los caches —saldo y nivel de morosidad— y lo que dicen las partidas.
 *
 * Cuelga de `settings` y no del listado porque exige el mismo permiso que la política y no es una
 * consulta de operación: se abre cuando algo no cuadra, no para trabajar.
 */
export const CHECKING_ACCOUNT_CONSISTENCY_PATH = '/panel/settings/checking-account-consistency';
