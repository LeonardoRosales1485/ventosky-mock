import { stockBatchTraceabilityPath } from '../../core/stock/stock-batch.model';
import { serialLookupPath } from '../../core/stock/stock-serial.model';

/**
 * El área de stock: el panel de vencimientos, la trazabilidad de una partida y la consulta por
 * número de serie. La raíz redirige al panel, que es lo que un rubro perecedero mira todos los días.
 */
export const STOCK_PATH = '/panel/stock';

export const EXPIRATIONS_PATH = `${STOCK_PATH}/expirations`;

/** La consulta de postventa por número de serie. */
export const SERIAL_LOOKUP_PATH = `${STOCK_PATH}/serial`;

/** Re-exportados desde `core/`: los enlazan también la ficha del producto y el carrito. */
export { stockBatchTraceabilityPath, serialLookupPath };
