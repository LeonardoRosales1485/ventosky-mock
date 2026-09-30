/**
 * El listado de traslados y las tres pantallas que cuelgan de él.
 *
 * A diferencia de compras y ventas —donde el alta ocupa su propia área del panel (`/panel/pos`,
 * `/panel/new-purchase`)— el alta del traslado vive **adentro** del área: es una sola entrada de
 * menú, y despachar y consultar los exige el mismo `stock.view` de base. Lo que separa a las dos
 * pantallas es `transfer.dispatch`, que el botón «Nuevo traslado» valida por su cuenta.
 */
export const STOCK_TRANSFERS_PATH = '/panel/stock-transfers';

/** El despacho de un traslado nuevo. */
export const NEW_STOCK_TRANSFER_PATH = `${STOCK_TRANSFERS_PATH}/new`;

/** El detalle: el recorrido, las líneas por lote y lo que falta para cerrarlo. */
export function stockTransferDetailPath(uuid: string): string {
  return `${STOCK_TRANSFERS_PATH}/${uuid}`;
}

/**
 * El remito imprimible. Cuelga del detalle porque es el mismo traslado en otro formato: el papel
 * que acompaña la mercadería y que se firma en las dos puntas.
 */
export function stockTransferRemitoPath(uuid: string): string {
  return `${stockTransferDetailPath(uuid)}/remito`;
}
