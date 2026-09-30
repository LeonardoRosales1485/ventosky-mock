/**
 * La fecha de operación del commit, en el formato que espera el backend.
 *
 * `OrderDTO.dateOperation` es un `LocalDateTime` de Java: fecha y hora **sin zona**. Vive en
 * `core/` porque lo escriben las dos pantallas que commitean —la venta y la compra— y el formato es
 * del contrato, no de ninguna de las dos.
 */

/**
 * `YYYY-MM-DDTHH:mm:ss` en hora local.
 *
 * A mano y no con `toISOString()`: ese convierte a UTC, y la fecha de operación es la del reloj de
 * la sucursal. Mandarla desplazada la imputaría a otra sesión de caja —o a ninguna— cada vez que el
 * huso no sea cero.
 */
export function toLocalDateTime(date: Date): string {
  return formatLocal(date);
}

/**
 * El camino de vuelta: la fecha-hora que devuelve el backend.
 *
 * Desde la v3.4.0 del backend viene como ISO 8601 con offset (`2026-08-20T10:30:00.000-03:00`), que
 * `new Date()` lee sin ambigüedad; un texto sin zona (`2026-08-20T10:30:00`) también entra, y se
 * interpreta en local. El trabajo acá es sólo defensivo — un valor ausente o ilegible devuelve
 * `null` en vez de un `Invalid Date` que se propaga hasta la pantalla como «NaN».
 */
export function fromLocalDateTime(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `YYYY-MM-DDTHH:mm`, que es lo que lee y escribe un `input[type=datetime-local]`. */
export function toLocalDateTimeInput(date: Date): string {
  return formatLocal(date).slice(0, 16);
}

/**
 * Si dos instantes caen el mismo día del calendario local. Es la pregunta con la que las pantallas
 * deciden qué pueden anticipar de la sesión de caja: el backend acepta una sesión abierta sólo
 * cuando la operación es **del mismo día**.
 */
export function isSameLocalDay(date: Date, other: Date): boolean {
  return (
    date.getFullYear() === other.getFullYear() &&
    date.getMonth() === other.getMonth() &&
    date.getDate() === other.getDate()
  );
}

function formatLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
