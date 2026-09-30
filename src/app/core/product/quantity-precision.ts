/**
 * Con cuánta precisión se puede mover un producto, réplica de `QuantityPrecisionValidator` del
 * backend.
 *
 * Lo declara la **unidad de medida** (`UnitMeasure.decimalPlaces`) y parte el catálogo en dos:
 * unidades discretas —unidad, caja, pack, docena, par: `0` decimales— y divisibles —kilo, litro,
 * metro, tonelada—. Media unidad no existe; medio kilo y tres cuartos de litro son cantidades
 * corrientes.
 *
 * El número llega con el producto en `unitDecimalPlaces` y **no** se replica acá a propósito: si el
 * front tuviera su propia tabla de precisiones, agregar una unidad del lado del backend dejaría a la
 * pantalla midiendo con otra vara que la que aplica el 400.
 *
 * Vive en `core` porque lo comparten todas las puntas que mueven cantidad —el punto de venta y el
 * ajuste de stock—, que son las mismas cuatro que valida el backend.
 */

/**
 * Cantidad de decimales que admite un producto, ya saneada. `null` es el producto **sin unidad
 * declarada**: no dice nada sobre su divisibilidad, así que no se le impone ninguna restricción, igual
 * que hace `UnitMeasure.decimalPlacesOrNull(null)` del otro lado.
 */
export type QuantityDecimals = number | null;

/** Lo que necesita saberse de un producto para medirlo. Es el subconjunto que traen todos sus DTOs. */
export interface QuantityMeasurable {
  unitDecimalPlaces?: number | null;
  /**
   * Eje de existencias (`NONE` | `QUANTITY` | `BATCH` | `SERIAL`). Sólo `SERIAL` cambia la
   * precisión, y la cambia por encima de la unidad: ver {@link quantityDecimalsOf}.
   */
  stockTracking?: string | null;
}

/**
 * El eje que manda sobre la unidad de medida. Con `SERIAL` hay **una fila por unidad física**, así
 * que la cantidad es la cantidad de series informadas y no puede tener decimales (RN-17).
 */
const SERIAL_TRACKING = 'SERIAL';

/**
 * Holgura con la que se decide si una cantidad **es** la de la precisión pedida. Cubre el error de
 * representación del número y queda muy por debajo del decimal más fino que declara una unidad
 * (1e-3). Es la `TOLERANCE` del validador del backend.
 */
const TOLERANCE = 1e-9;

/**
 * A qué cantidad se cae un valor no positivo cuando el producto no declara unidad. No es un mínimo
 * general —ese sale de la unidad—, es sólo el reemplazo de un cero que no puede viajar.
 */
const FALLBACK_MIN_QUANTITY = 1;

/**
 * Precisión declarada por el producto, o `null` si no declara ninguna. Descarta lo que no sea un
 * entero no negativo: un `unitDecimalPlaces` corrupto no debe convertirse en una restricción
 * inventada, y la pantalla que la aplique no tiene por qué defenderse sola.
 */
export function quantityDecimalsOf(product: QuantityMeasurable | null | undefined): QuantityDecimals {
  /*
   * El eje gana sobre la unidad, y en un solo caso: con `SERIAL` cada unidad física es una fila de
   * `stock_serials`, así que la cantidad de la línea es cuántas series se informaron —un entero—
   * sin importar los decimales que admita la unidad (RN-17). Un producto serializado que se mide en
   * kilos es raro pero no imposible, y ahí la unidad diría `3` decimales mientras el commit exige
   * que la cantidad coincida con la cantidad de números: la línea quedaría trabada sin que la
   * pantalla pueda explicar por qué.
   */
  if (product?.stockTracking === SERIAL_TRACKING) {
    return 0;
  }

  const declared = product?.unitDecimalPlaces;

  return typeof declared === 'number' && Number.isInteger(declared) && declared >= 0
    ? declared
    : null;
}

/** Si la unidad del producto admite cantidades fraccionarias. `UnitMeasure.allowsFractional()`. */
export function allowsFractionalQuantity(decimals: QuantityDecimals): boolean {
  return decimals !== 0;
}

/**
 * Con qué salto se mueve el `<input type="number">`: `1` para una unidad discreta, el decimal más
 * fino que admita para una divisible.
 *
 * `'any'` —el producto sin unidad— es el valor del atributo HTML que deja escribir cualquier decimal;
 * `step="1"` es el que hoy hace que el navegador marque `1,5` como inválido en **todos** los
 * productos, incluido el que se vende por kilo.
 */
export function quantityStep(decimals: QuantityDecimals): number | 'any' {
  if (decimals === null) {
    return 'any';
  }

  return decimals === 0 ? 1 : shift(1, -decimals);
}

/**
 * La cantidad más chica que se puede pedir: una unidad de la discreta, un decimal del más fino de la
 * divisible. Es el piso con el que el carrito reemplaza al `1` que hoy usa para todo —y que es
 * justamente lo que impide vender 0,75 kg—.
 *
 * `null` (producto sin unidad) no tiene piso declarado: lo único exigible es que sea positiva, y de
 * eso se ocupa quien valida.
 */
export function minQuantity(decimals: QuantityDecimals): number | null {
  const step = quantityStep(decimals);

  return step === 'any' ? null : step;
}

/**
 * Ajusta la cantidad a la precisión de la unidad, redondeando al más cercano y con el empate hacia
 * arriba: es el `BigDecimal.setScale(decimals, HALF_UP)` del validador del backend.
 *
 * Sin precisión declarada devuelve la cantidad tal cual: no hay a qué ajustarla.
 */
export function roundQuantity(value: number, decimals: QuantityDecimals): number {
  if (decimals === null || !Number.isFinite(value)) {
    return value;
  }

  return shift(halfUp(shift(value, decimals)), -decimals);
}

/**
 * Si la cantidad entra en la precisión de la unidad. Se compara con {@link TOLERANCE} y no por
 * igualdad porque la cantidad es un `number`: un `0,7` legítimo puede valer 0,6999999999999999, y eso
 * no es un decimal de más.
 */
export function isQuantityPrecisionValid(value: number, decimals: QuantityDecimals): boolean {
  if (decimals === null) {
    return true;
  }

  return Math.abs(roundQuantity(value, decimals) - value) <= TOLERANCE;
}

/**
 * La cantidad con la que quedarse cuando el operador escribió algo: ajustada a la precisión de la
 * unidad y nunca por debajo del salto más chico.
 *
 * Ajusta en vez de rechazar porque quien la usa es el carrito, que no tiene dónde poner un mensaje de
 * error por línea: escribir `1,5` en un producto que se vende por unidad deja `2`, igual que escribir
 * `0` deja `1`. Lo que **no** puede pasar es que la línea viaje con una cantidad que el commit va a
 * rechazar.
 */
export function clampQuantity(value: number, decimals: QuantityDecimals): number {
  const rounded = roundQuantity(value, decimals);
  const floor = minQuantity(decimals);

  if (floor !== null) {
    return Math.max(floor, rounded);
  }

  /*
   * Sin unidad declarada no hay granularidad con la que armar un piso, pero cero o negativo no es una
   * cantidad —el commit la rechaza—, así que ahí se cae a una unidad: es lo que el carrito hacía para
   * todo el catálogo. Lo que **no** se hace es usar ese 1 como mínimo general, porque volvería a
   * bloquear el 0,75 que este producto sí puede pedir.
   */
  return rounded > 0 ? rounded : FALLBACK_MIN_QUANTITY;
}

/** `HALF_UP`: el empate se aleja del cero, y `Math.round` lo llevaría a +∞. */
function halfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Corre la coma `exponent` lugares sobre la representación decimal **corta** del número, que es la que
 * el usuario ve. Es lo que hace `BigDecimal.valueOf(double)` del otro lado, y evita que ajustar un
 * 0,7 guardado como 0,6999999999999999 lo baje a 0,69.
 *
 * Gemelo del de `core/pricing/price-rounding.ts`: cada módulo espeja un service distinto del backend
 * y se sostiene solo, pero el truco es el mismo y conviene tocarlos juntos.
 */
function shift(value: number, exponent: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }

  const [mantissa, magnitude = '0'] = value.toExponential().split('e');
  return Number(`${mantissa}e${Number(magnitude) + exponent}`);
}
