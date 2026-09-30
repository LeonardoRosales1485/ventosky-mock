/**
 * Alta de una orden de compra: la pantalla en la que se registra la operación.
 *
 * Es la raíz de su área, así que el ítem del sidebar entra directo acá. El plural
 * —{@link PURCHASES_PATH}— es el listado de las compras realizadas, el mismo reparto que hacen
 * `/panel/pos` (registrar) y `/panel/sales` (listar, todavía sin pantalla).
 */
export const NEW_PURCHASE_PATH = '/panel/new-purchase';

/**
 * El listado de las compras realizadas. Es el plural que el alta dejó libre a propósito: acá se
 * consultan las operaciones ya registradas, no se carga una nueva.
 */
export const PURCHASES_PATH = '/panel/purchases';

/**
 * Edición de una compra. Vive bajo el listado —y no bajo el alta— porque se llega desde la fila y
 * porque el permiso que la abre es el del listado (`purchase.view`) más `purchase.edit`, no el de
 * crear.
 *
 * Sólo tiene sentido para una **orden de compra borrador**: es lo único que el backend deja editar
 * (`POST /order/{uuid}/convert`). Ver `isEditablePurchase` en `data-access/purchase.model.ts`.
 */
export function purchaseEditPath(uuid: string): string {
  return `${PURCHASES_PATH}/${uuid}/edit`;
}

/**
 * «Mis ventas»: el portal del proveedor, que sólo ve las compras que la empresa le hizo a su ficha. Es
 * el listado de compras en modo `own`; el backend es quien acota.
 */
export const MY_SALES_PATH = '/panel/my-sales';
