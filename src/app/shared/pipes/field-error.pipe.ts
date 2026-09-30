import { Pipe, PipeTransform, inject } from '@angular/core';
import { ValidationError } from '@angular/forms/signals';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../core/i18n/language.service';

const TRANSLATION_PREFIX = 'validation.';

/**
 * Resolves the first Signal Forms validation error into a localized message.
 * Translation key is `validation.{error.kind}` (e.g. validation.required).
 */
@Pipe({
  name: 'fieldError',
  pure: false,
})
export class FieldErrorPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  transform(errors: readonly ValidationError[] | null | undefined): string {
    // Depend on the active language so messages refresh when it changes.
    this.language.currentLang();

    const error = errors?.[0];
    if (!error) {
      return '';
    }

    return this.translate.instant(`${TRANSLATION_PREFIX}${error.kind}`, this.getParams(error));
  }

  private getParams(error: ValidationError): Record<string, string | number> {
    const params: Record<string, string | number> = {};
    const locale = this.language.localeId();

    const min = readNumber(error, 'min');
    if (min !== undefined) {
      params['min'] = min;
    }

    const max = readNumber(error, 'max');
    if (max !== undefined) {
      params['max'] = max;
    }

    const minLength = readNumber(error, 'minLength');
    if (minLength !== undefined) {
      params['minLength'] = minLength;
    }

    const maxLength = readNumber(error, 'maxLength');
    if (maxLength !== undefined) {
      params['maxLength'] = maxLength;
    }

    const length = readNumber(error, 'length');
    if (length !== undefined) {
      params['length'] = length;
    }

    // Decimales que admite la unidad de medida del producto (`quantityPrecision`).
    const decimals = readNumber(error, 'decimals');
    if (decimals !== undefined) {
      params['decimals'] = decimals;
    }

    const minDate = readDate(error, 'minDate');
    if (minDate) {
      params['minDate'] = formatDate(minDate, locale);
    }

    const maxDate = readDate(error, 'maxDate');
    if (maxDate) {
      params['maxDate'] = formatDate(maxDate, locale);
    }

    const pattern = readPattern(error);
    if (pattern) {
      params['pattern'] = pattern;
    }

    return params;
  }
}

function readNumber(error: object, key: string): number | undefined {
  if (!(key in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function readDate(error: object, key: string): Date | undefined {
  if (!(key in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[key];
  return value instanceof Date ? value : undefined;
}

function readPattern(error: object): string | undefined {
  if (!('pattern' in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)['pattern'];
  return value instanceof RegExp ? value.source : undefined;
}

function formatDate(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value);
}
