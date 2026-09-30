/**
 * El punto de venta. La ruta nombra al modo —`pos`— y no al dominio: `/panel/sales` es el listado de
 * las ventas realizadas, que es otra pantalla de esta misma feature.
 */
export const POS_PATH = '/panel/pos';

/**
 * El listado de las ventas realizadas. Es el plural que el punto de venta dejó libre: acá se
 * consultan las operaciones ya registradas, no se carga una nueva.
 */
export const SALES_PATH = '/panel/sales';

/**
 * «Mis compras»: el portal del cliente, que sólo ve las ventas cuya contraparte es su ficha. Es el
 * listado de ventas en modo `own`; el backend es quien acota.
 */
export const MY_PURCHASES_PATH = '/panel/my-purchases';
