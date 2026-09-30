/**
 * Fechas de calendario en `YYYY-MM-DD`: días completos, sin hora y sin zona.
 *
 * Es el formato con el que viajan los `LocalDate` del backend —el vencimiento de una deuda, la
 * vigencia de una promoción— y el que hay que darle y sacarle al datepicker de Material, que trabaja
 * con `Date`. Vive en `core` porque no es de ninguna feature: la cuenta corriente y las promociones
 * hacen la misma aritmética sobre el mismo formato, y escrita dos veces se desincroniza.
 *
 * Para la fecha **con hora** del commit de una orden, ver `core/orders/local-date-time.ts`: ése es
 * otro contrato (`LocalDateTime`) y otro formato.
 */

/** Hoy, en `YYYY-MM-DD` y en hora local: es la fecha contra la que vence y rige todo. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Parsea `YYYY-MM-DD` como medianoche **local**. `new Date('2026-08-24')` la interpreta como UTC y
 * en Argentina eso da el día anterior, que es exactamente el error que corre un vencimiento un día.
 */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Días enteros de `from` a `to`; negativo si `to` es anterior. */
export function daysBetween(from: string, to: string): number {
  const millis = parseIsoDate(to).getTime() - parseIsoDate(from).getTime();
  return Math.round(millis / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}
