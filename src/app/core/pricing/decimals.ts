/**
 * Aritmética de importes en `number`, con las mismas reglas de escala y redondeo que el
 * `BigDecimal` del backend (`Decimals` del lado Java).
 *
 * El backend calcula en `BigDecimal` justamente porque un `double` no representa 0,1 ni 0,7 y la
 * acumulación va corriendo el resultado. Acá no hay `BigDecimal`, así que el error se ataca por el
 * otro lado: **cada paso vuelve a la escala de trabajo**, que es la de las columnas
 * (`NUMERIC(19,6)`). Un resultado exacto a seis decimales entra y sale idéntico; la basura binaria
 * que el paso anterior arrastró —el 2184,0500000000002 de restar dos importes— se limpia ahí.
 *
 * Lo que hace el redondeo posible es {@link shift}: corre la coma sobre la representación decimal
 * **corta** del número, que es la que el usuario ve y la que `BigDecimal.valueOf(double)` toma del
 * otro lado. Multiplicar por `10 ** n` arrastraría el error binario en vez de borrarlo.
 */

/**
 * Decimales con los que se calcula, igual que `Decimals.SCALE`: la escala de las columnas, más fina
 * que la del resultado. La plata se cierra a dos decimales en cada paso de la cascada; los valores
 * intermedios —un factor, un impuesto prorrateado— necesitan lugar antes de ese redondeo.
 */
export const DECIMAL_SCALE = 6;

/**
 * `RoundingMode.HALF_UP` sobre un entero: al más cercano, y el empate se aleja del cero.
 * `Math.round` solo llevaría el empate hacia +∞, que no es lo mismo en negativos.
 */
export function halfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Corre la coma `exponent` lugares sobre la representación decimal **corta** del número.
 *
 * Es lo que evita que redondear "hacia arriba" un 198,6 guardado como 198,60000000000002 lo suba a
 * 198,61: reescribir el exponente en notación científica no ve ese error, multiplicar sí.
 */
export function shift(value: number, exponent: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }

  const [mantissa, magnitude = '0'] = value.toExponential().split('e');
  return Number(`${mantissa}e${Number(magnitude) + exponent}`);
}

/** `setScale(decimals, HALF_UP)`. */
export function roundHalfUp(value: number, decimals: number): number {
  return shift(halfUp(shift(value, decimals)), -decimals);
}

/** `PromotionDiscountCascade.round2`: el redondeo de la plata, a dos decimales. */
export function round2(value: number): number {
  return roundHalfUp(value, 2);
}

/**
 * `Decimals.scaled`: deja el valor en la escala de trabajo. Es lo que se aplica después de sumar o
 * restar importes para que el resultado sea el mismo que el `BigDecimal` exacto del backend.
 */
export function scaled(value: number): number {
  return roundHalfUp(value, DECIMAL_SCALE);
}

/**
 * `Decimals.divide`: división en la escala de trabajo. Dividir por cero devuelve cero en lugar de
 * explotar, igual que del otro lado —quien divide por una cantidad o por un total que puede ser
 * cero quería ese mismo cero—.
 */
export function divide(dividend: number, divisor: number): number {
  if (!divisor) {
    return 0;
  }

  return roundHalfUp(dividend / divisor, DECIMAL_SCALE);
}
