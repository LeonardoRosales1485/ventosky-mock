import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from '../../core/i18n/language.service';

const FORMAT_PRESETS = {
  shortDate: { dateStyle: 'short' },
  mediumDate: { dateStyle: 'medium' },
  longDate: { dateStyle: 'long' },
  fullDate: { dateStyle: 'full' },
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'short' },
  long: { dateStyle: 'long', timeStyle: 'medium' },
  /** `29 sep`: la fecha corta de las tablas de la Propuesta B. */
  dayMonth: { day: 'numeric', month: 'short' },
  /** `13:42`. */
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type LocalizedDatePreset = keyof typeof FORMAT_PRESETS;
export type LocalizedDateFormat =
  | LocalizedDatePreset
  | Intl.DateTimeFormatOptions;

@Pipe({
  name: 'localizedDate',
  pure: false,
})
export class LocalizedDatePipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(
    value: string | number | Date | null | undefined,
    format: LocalizedDateFormat = 'mediumDate',
  ): string {
    if (value == null || value === '') {
      return '';
    }

    const date = toDate(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const options =
      typeof format === 'string' ? FORMAT_PRESETS[format] : format;

    return new Intl.DateTimeFormat(this.language.localeId(), options).format(
      date,
    );
  }
}

/** `2026-08-24`: una fecha de calendario, sin hora ni zona. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `new Date('2026-08-24')` se interpreta como medianoche **UTC**, así que al oeste de Greenwich
 * —Argentina incluida— se muestra el día anterior. Un `YYYY-MM-DD` no trae zona: es una fecha de
 * calendario, y lo que hay que mostrar es ese día, no el instante que le tocaría en UTC.
 *
 * Sólo alcanza a ese formato exacto. Un timestamp completo sí trae zona (o es UTC explícito) y se
 * sigue parseando como siempre.
 */
function toDate(value: string | number | Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(value);
}
