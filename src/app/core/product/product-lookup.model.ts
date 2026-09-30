/**
 * Qué devuelve resolver una lectura del escáner, y qué hacer con eso al armar una línea.
 *
 * Vive en `core` porque lo comparten las dos puntas que cargan mercadería —el punto de venta y la
 * compra— y porque `AGENTS.md` prohíbe lógica de dominio en `shared/`. Los tipos son genéricos en el
 * producto para que cada feature reciba el suyo (`SaleProductDto`, `PurchaseProductDto`) sin que
 * `core` conozca ninguno.
 */

/**
 * El empaque que resolvió una lectura, o el que el operador eligió en la línea. Es el subconjunto
 * del `ProductPackagingDTO` que la línea necesita: cómo se llama y cuántas unidades base trae.
 *
 * **No es un producto** (RN-16): no tiene stock ni precio propio. El saldo se lleva siempre en la
 * unidad base del producto, y esto es sólo el factor con el que se convierte.
 */
export interface PackagingRef {
  uuid?: string | null;
  name: string;
  /** Unidades base que contiene. Siempre `> 0`: lo garantiza el backend. */
  factor: number;
}

/**
 * El desarme de una etiqueta de balanza (`ScaleReadingDTO`).
 *
 * Las cuatro partes viajan y no sólo el resultado porque son lo único que hay que entender para
 * configurar bien el formato, y son lo que hace diagnosticable uno mal cargado: la pantalla las
 * muestra y se ve de una si el prefijo o los largos no eran los de esa balanza.
 */
export interface ScaleReading {
  prefix: string;
  /** El código interno con el que se resolvió el producto (`products.scaleCode`). */
  scaleCode: string;
  rawValue: string;
  /** Se muestra, no se valida: cada marca de balanza lo calcula distinto. */
  checkDigit: string;
  /** `WEIGHT` o `AMOUNT`: qué embebe la etiqueta de esta empresa. */
  valueType: string;
  /** La cantidad de la línea cuando la etiqueta trae peso; `null` si trae importe. */
  quantity?: number | null;
  /** El importe de la línea cuando la etiqueta lo trae; `null` si trae peso. */
  amount?: number | null;
}

/**
 * Respuesta de `GET /product/by-barcode` (`ProductBarcodeLookupDTO`). Una sola lectura cubre los
 * tres casos, y el mostrador no tiene que saber cuál es antes de pasar el producto por el lector:
 *
 * - **código del producto** — `factor: 1`, sin `packaging` ni `scale`;
 * - **código de un empaque** — `factor` es el de la caja, así que escanearla carga 12 unidades;
 * - **etiqueta de balanza** — `scale` trae el desarme y la cantidad leída (RN-18).
 */
export interface ProductCodeLookup<TProduct> {
  barcode: string;
  isPrimary?: boolean | null;
  /** Unidades base por lectura del código: el factor del empaque, o `1`. */
  factor?: number | null;
  packaging?: PackagingRef | null;
  scale?: ScaleReading | null;
  product: TProduct;
}

/**
 * Cómo interpretar la lectura.
 *
 * - `AUTO` (el default del backend): el mostrador. Entra cualquier lectura y el backend prueba
 *   primero etiqueta de balanza y después código de barras.
 * - `SCALE`: el operador dijo que es una etiqueta. Sin formato configurado responde
 *   `SCALE_FORMAT_NOT_CONFIGURED` en vez de buscarla como código de barras, que es el único camino
 *   por el que ese faltante se puede **decir**.
 */
export type ProductLookupMode = 'AUTO' | 'SCALE';

/**
 * Cuántas unidades base carga una lectura: la cantidad que trajo la etiqueta de balanza, o el factor
 * del empaque, o una unidad.
 *
 * El orden importa y no es arbitrario: una etiqueta de balanza **ya trae** la cantidad pesada, así
 * que multiplicarla por nada más sería inventar mercadería. Los tres casos son excluyentes del lado
 * del backend, pero decidirlo acá deja la regla en un solo lugar.
 */
export function scannedQuantityOf<TProduct>(lookup: ProductCodeLookup<TProduct>): number {
  const scanned = lookup.scale?.quantity;
  if (scanned != null && scanned > 0) {
    return scanned;
  }

  const factor = lookup.factor;
  return factor != null && factor > 0 ? factor : 1;
}

/**
 * Si la lectura <b>determinó ella misma</b> cuánto entra: el peso de una etiqueta de balanza o el
 * factor de una caja. En ese caso la cantidad ya es la definitiva y nadie la vuelve a tocar.
 *
 * Lo contrario es el «1 neutro»: el código del producto suelto, o una elección del buscador. Ahí la
 * cantidad no dice nada sobre la unidad de compra, y es la única situación en la que adoptar el
 * empaque por defecto tiene que arrancar la línea en <b>un empaque</b> —un bulto, no una milésima
 * de bulto—, porque el default es justamente «así lo compro».
 */
export function readCarriesQuantity<TProduct>(lookup: ProductCodeLookup<TProduct>): boolean {
  const scanned = lookup.scale?.quantity;
  if (scanned != null && scanned > 0) {
    return true;
  }

  const factor = lookup.factor;
  return factor != null && factor > 1;
}

/**
 * Cuántos empaques representa una cantidad en unidad base, para mostrar la equivalencia. Sin empaque
 * —o con un factor que no sirve— devuelve `null`: no hay equivalencia que mostrar.
 */
export function packageQuantityOf(
  baseQuantity: number,
  packaging: PackagingRef | null,
): number | null {
  if (!packaging || !(packaging.factor > 0)) {
    return null;
  }

  return baseQuantity / packaging.factor;
}

/** Las unidades base que representan `packageQuantity` empaques. */
export function baseQuantityOf(packageQuantity: number, packaging: PackagingRef | null): number {
  if (!packaging || !(packaging.factor > 0)) {
    return packageQuantity;
  }

  return packageQuantity * packaging.factor;
}

/**
 * El empaque con el que arranca una línea, si el producto declaró uno por defecto para esa
 * operación. Lo aplica el front —el backend guarda los flags pero no los lee—: la conversión es del
 * lado de quien carga la línea.
 */
export function defaultPackagingOf(
  packagings: readonly PackagingDefaults[] | null | undefined,
  operation: 'purchase' | 'sale',
): PackagingRef | null {
  const rows = packagings ?? [];
  const match = rows.find((row) =>
    operation === 'purchase' ? row.isPurchaseDefault === true : row.isSaleDefault === true,
  );

  return match ? { uuid: match.uuid, name: match.name, factor: match.factor } : null;
}

/** Lo que hace falta saber de un empaque para elegir el default de una operación. */
export interface PackagingDefaults extends PackagingRef {
  isPurchaseDefault?: boolean | null;
  isSaleDefault?: boolean | null;
}
