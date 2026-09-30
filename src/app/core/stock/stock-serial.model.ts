import { UuidNameRef } from '../http/api-refs';

/**
 * En qué situación está una unidad física (`SerialState`). No es el `status` de la fila —eso es la
 * baja lógica del registro— sino dónde está la **unidad**.
 *
 * **Sólo `IN_STOCK` cuenta para el saldo.** Es la invariante de §9 del funcional, la misma que la
 * ficha verifica en pantalla: el saldo de las partidas tiene que dar la cantidad de series
 * `IN_STOCK` de ese depósito.
 *
 * `IN_TRANSIT` es la unidad que un traslado despachó y que nadie recibió todavía: **ya salió del
 * origen y no existe en el destino**, así que no la puede vender ninguna de las dos puntas y no
 * suma a ningún saldo. La recepción la deja `IN_STOCK` en el depósito destino; la cancelación, en
 * el de origen.
 */
export const SERIAL_STATES = [
  'IN_STOCK',
  'SOLD',
  'RETURNED',
  'IN_TRANSIT',
  'SCRAPPED',
] as const;

export type SerialState = (typeof SERIAL_STATES)[number];

/** Una unidad física en la grilla de la solapa Stock (`ProductSerialDTO`, wireframe `1f`). */
export interface ProductSerialDto {
  uuid: string;
  serialNumber: string;
  state: SerialState;
  /**
   * Dónde está la unidad. Nulo en las vendidas: ya no están en ningún depósito, y mostrar el último
   * sería decir que siguen ahí. La devuelta sí lo trae — físicamente está.
   */
  warehouse?: UuidNameRef | null;
  /** El lote, cuando el producto además lleva partida (P9). */
  batchNumber?: string | null;
  /** La operación que la ingresó; `name` es su número visible (`C-0117`). */
  entryOrigin?: UuidNameRef | null;
  /** La operación que la sacó, o nulo mientras siga en stock. */
  exitOrigin?: UuidNameRef | null;
  dateCreated?: string | null;
}

/** Response de `GET /stock/serials/{productUuid}` (`ProductSerialsDTO`). */
export interface ProductSerialsDto {
  product: UuidNameRef;
  productSku?: string | null;
  /** `true` cuando la lectura abarcó toda la empresa (se omitió `X-Branch-Uuid`). */
  allBranches: boolean;
  inStockCount: number;
  soldCount: number;
  returnedCount: number;
  /** En viaje: despachadas por un traslado y todavía sin recibir. No suman a ningún saldo. */
  inTransitCount: number;
  scrappedCount: number;
  /**
   * Saldo que declaran las partidas del producto, y si coincide con `inStockCount`. Vienen
   * **siempre**, coincidan o no: la invariante se muestra porque es lo primero que se rompe, y un
   * cartel que sólo apareciera cuando ya está rota no serviría para confiar en el número el resto
   * del tiempo.
   */
  balanceQuantity: number;
  consistent: boolean;
  rows: ProductSerialDto[];
}

/** El tercero de un tramo de la consulta por serie, con su contacto (`SerialPartyDTO`). */
export interface SerialPartyDto {
  uuid: string;
  name: string;
  docType?: string | null;
  docNumber?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Un tramo de la vida de la unidad: cómo entró o cómo salió (`SerialLookupEventDTO`). */
export interface SerialLookupEventDto {
  orderUuid: string;
  /** Número visible de la operación: `C-0117`, `V-8891`. */
  publicId?: string | null;
  dateOperation?: string | null;
  voucher?: UuidNameRef | null;
  branch?: UuidNameRef | null;
  /** Sólo en el ingreso: en la salida la unidad ya no está en ningún depósito. */
  warehouse?: UuidNameRef | null;
  /** Proveedor en el ingreso, cliente en la salida. Nulo es consumidor final. */
  party?: SerialPartyDto | null;
}

/**
 * Response de `GET /stock/serial/{serialNumber}` (`SerialLookupDTO`, wireframe `1q`).
 *
 * Es **una línea de tiempo y no una tabla**: la unidad tiene a lo sumo una entrada y una salida, así
 * que la respuesta es una sola y se lee de arriba abajo.
 */
export interface SerialLookupDto {
  uuid: string;
  serialNumber: string;
  state: SerialState;
  product: UuidNameRef;
  productSku?: string | null;
  /** El modelo del que la variante es parte, cuando el producto es una variante. */
  productModel?: UuidNameRef | null;
  batchNumber?: string | null;
  entry?: SerialLookupEventDto | null;
  /** Nulo si la unidad sigue en stock. */
  exit?: SerialLookupEventDto | null;
}

/**
 * Body de las dos acciones de postventa sobre una unidad, `POST /stock/serial/return` y
 * `POST /stock/serial/reinstate`: la unidad se identifica por su número y lo que cambia es qué hace
 * cada endpoint con ella.
 */
export interface SerialActionPayload {
  serialNumber: string;
}

/**
 * Si el producto se mueve por **unidad identificada**: cada una es una fila de `stock_serials` y la
 * cantidad de una línea es cuántos números se informaron (RN-17).
 *
 * Vive en `core/` porque la pregunta es del producto y la hacen la venta, la compra y el traslado.
 * Cuando cada pantalla la contestaba por su cuenta, agregar un caso era acordarse de las otras dos.
 */
export function isSerialTracked(product: { stockTracking?: string | null }): boolean {
  return product.stockTracking === 'SERIAL';
}

/** Ruta de la consulta por serie, con el número ya cargado en el buscador. */
export function serialLookupPath(serialNumber?: string): string {
  return serialNumber
    ? `/panel/stock/serial/${encodeURIComponent(serialNumber)}`
    : '/panel/stock/serial';
}
