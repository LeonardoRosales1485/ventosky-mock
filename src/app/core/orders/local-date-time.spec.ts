import { describe, expect, it } from 'vitest';
import { isSameLocalDay, toLocalDateTime, toLocalDateTimeInput } from './local-date-time';

describe('local-date-time', () => {
  /**
   * El caso que justifica no usar `toISOString()`: a esa hora, en cualquier huso al oeste de
   * Greenwich, el UTC ya es del día siguiente. Mandada así, la venta se imputaría a la sesión de
   * caja de mañana —o a ninguna—.
   */
  it('writes the local clock and not UTC', () => {
    expect(toLocalDateTime(new Date(2026, 7, 19, 23, 45, 30))).toBe('2026-08-19T23:45:30');
  });

  it('pads every field to two digits', () => {
    expect(toLocalDateTime(new Date(2026, 0, 5, 9, 8, 7))).toBe('2026-01-05T09:08:07');
  });

  it('drops the seconds for the datetime-local input', () => {
    expect(toLocalDateTimeInput(new Date(2026, 7, 19, 23, 45, 30))).toBe('2026-08-19T23:45');
  });

  it('compares the calendar day and not the elapsed hours', () => {
    expect(isSameLocalDay(new Date(2026, 7, 19, 0, 5), new Date(2026, 7, 19, 23, 55))).toBe(true);
    expect(isSameLocalDay(new Date(2026, 7, 19, 23, 55), new Date(2026, 7, 20, 0, 5))).toBe(false);
  });

  /** Mismo día y mes, otro año: sin comparar el año, un asiento de hace 12 meses pasaría por hoy. */
  it('does not confuse the same day of another year', () => {
    expect(isSameLocalDay(new Date(2025, 7, 19), new Date(2026, 7, 19))).toBe(false);
  });
});
