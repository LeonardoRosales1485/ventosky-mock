/**
 * Las claves del contexto de operación: empresa, sucursal y caja.
 *
 * Viven acá y no en `local-storage-keys.constants.ts` porque ya no son de localStorage: el valor
 * vigente es el de este tab y lo que queda en localStorage es la semilla que hereda el próximo tab
 * que se abra. Ver `TabContextStore`.
 *
 * Las cadenas no cambiaron a propósito: la semilla que cada usuario ya tiene guardada es la misma de
 * siempre, así que no hay nada que migrar.
 */
export const COMPANY_UUID_KEY = 'companyUuid';
export const BRANCH_UUID_KEY = 'branchUuid';

/**
 * La caja recordada de cada sucursal: `ventosky.sales.cashRegisterUuid.<branchUuid>`.
 *
 * El `sales` del medio quedó de cuando esto vivía en el feature de ventas, y se conserva a
 * propósito: la caja recordada es la misma para las dos pantallas, y renombrar la clave le borraría
 * a cada usuario la que ya tiene elegida.
 */
export const CASH_REGISTER_KEY_PREFIX = 'ventosky.sales.cashRegisterUuid.';

/** Que este tab ya fijó su contexto. Ver `TabContextStore.seal()`. */
export const TAB_SEALED_KEY = 'ventosky.tab.sealed';
