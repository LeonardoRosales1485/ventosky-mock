import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageService } from '../../core/i18n/language.service';
import { LocalizedDatePipe } from './localized-date.pipe';

describe('LocalizedDatePipe', () => {
  let pipe: LocalizedDatePipe;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        LocalizedDatePipe,
        { provide: LanguageService, useValue: { localeId: () => 'es-AR' } },
      ],
    });

    pipe = TestBed.inject(LocalizedDatePipe);
  });

  /**
   * El caso que motivó el parser propio: `new Date('2026-08-24')` es medianoche UTC, y al oeste de
   * Greenwich eso cae el día anterior. Una fecha de calendario no tiene zona, así que se muestra tal
   * cual se escribió.
   */
  it('renders a date-only string as that calendar day, not shifted by the timezone', () => {
    expect(pipe.transform('2026-08-24', 'shortDate')).toBe('24/8/26');
  });

  it('still parses a full timestamp with its own offset', () => {
    // Mediodía UTC cae el mismo día en cualquier huso entre UTC-11 y UTC+11.
    expect(pipe.transform('2026-08-24T12:00:00Z', 'shortDate')).toBe('24/8/26');
  });

  it('accepts a Date and returns empty for anything unusable', () => {
    expect(pipe.transform(new Date(2026, 7, 24), 'shortDate')).toBe('24/8/26');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform('no es una fecha')).toBe('');
  });
});
