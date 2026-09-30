import { DEFAULT_PHONE_ISO2, PHONE_CODES, PhoneCode, resolvePhoneCode } from './phone-codes';

/**
 * Value shape and formatting rules behind `PhoneInputComponent`.
 *
 * A phone number is kept split in two pieces — the country and the national
 * digits — because the dial code alone cannot identify the country (`+1` is both
 * US and CA), and the country drives the grouping shown to the user. `e164` is
 * derived from both so consumers can submit the number without recombining it.
 */

/** Digits a full E.164 number may have, country code included. */
export const E164_MAX_DIGITS = 15;

/** Shortest national number accepted by `phoneNumber()`. */
export const NATIONAL_MIN_DIGITS = 4;

export interface PhoneValue {
  /** ISO 3166-1 alpha-2 code of the selected country. */
  iso2: string;
  /** Dial code of the selected country, e.g. `'+54'`. */
  phoneCode: string;
  /** National number, digits only, no grouping. */
  nationalNumber: string;
  /** `'+541112345678'`, or `''` while no national number has been typed. */
  e164: string;
}

/** Keeps only the digits of `raw`, dropping spaces, dashes and `+`. */
export function digitsOf(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Builds a value, normalizing the country and dropping anything that would push
 * the number past the E.164 limit.
 *
 * @param iso2 - Country code. Unknown codes fall back to `DEFAULT_PHONE_ISO2`.
 * @param nationalNumber - National number; non-digits are stripped.
 */
export function createPhoneValue(iso2: string, nationalNumber: string): PhoneValue {
  const country = resolvePhoneCode(iso2);
  const digits = digitsOf(nationalNumber).slice(0, maxNationalDigits(country));

  return {
    iso2: country.iso2,
    phoneCode: country.phoneCode,
    nationalNumber: digits,
    e164: digits ? `${country.phoneCode}${digits}` : '',
  };
}

/**
 * An empty value, ready to be used as the initial state of a form model.
 *
 * @param iso2 - Country preselected in the selector.
 */
export function emptyPhoneValue(iso2: string = DEFAULT_PHONE_ISO2): PhoneValue {
  return createPhoneValue(iso2, '');
}

/** How many national digits still fit under the 15-digit E.164 limit. */
export function maxNationalDigits(country: PhoneCode): number {
  return E164_MAX_DIGITS - digitsOf(country.phoneCode).length;
}

/**
 * Groups `digits` the way `country.format` does: `'1112345678'` becomes
 * `'11 1234 5678'` for Argentina.
 *
 * The format is a hint, not a limit. Numbers longer than the template keep their
 * extra digits appended, since a single template cannot cover every number
 * length a country uses (Brazilian mobiles have one digit more than landlines).
 *
 * @param digits - National number, digits only.
 * @param country - Country whose grouping applies.
 */
export function formatNationalNumber(digits: string, country: PhoneCode): string {
  const mask = nationalPart(country.format, country.phoneCode);
  let formatted = '';
  let cursor = 0;

  for (const char of mask) {
    if (cursor >= digits.length) {
      break; // Stops before a trailing separator.
    }
    formatted += isPlaceholder(char) ? digits[cursor++] : char;
  }

  return formatted + digits.slice(cursor);
}

/** The sample number without its dial code, e.g. `'11 1234 5678'`. */
export function nationalExample(country: PhoneCode): string {
  return nationalPart(country.example, country.phoneCode);
}

/**
 * Reads a number the user pasted or that came from an API.
 *
 * Only an international number (`+54 …` or `0054 …`) can pick the country by
 * itself; anything else is treated as a national number of `fallbackIso2`.
 *
 * @param raw - Text to read.
 * @param fallbackIso2 - Country used when `raw` carries no dial code.
 */
export function parsePhoneNumber(
  raw: string,
  fallbackIso2: string = DEFAULT_PHONE_ISO2,
): PhoneValue {
  const country = matchDialCode(raw, fallbackIso2);
  if (!country) {
    return createPhoneValue(fallbackIso2, raw);
  }

  const digits = digitsOf(raw).replace(/^00/, '');

  return createPhoneValue(country.iso2, digits.slice(digitsOf(country.phoneCode).length));
}

/**
 * The country whose dial code `raw` starts with, or `undefined` when `raw` has
 * no international prefix.
 *
 * Ties (`+1` is US and CA) resolve to `preferredIso2` when it is one of the
 * candidates, so re-reading a Canadian number does not turn it into a US one.
 */
function matchDialCode(raw: string, preferredIso2: string): PhoneCode | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('+') && !trimmed.startsWith('00')) {
    return undefined;
  }

  const digits = digitsOf(trimmed).replace(/^00/, '');
  let matches: PhoneCode[] = [];

  for (const country of PHONE_CODES) {
    const dial = digitsOf(country.phoneCode);
    if (!digits.startsWith(dial)) {
      continue;
    }

    const best = matches[0] ? digitsOf(matches[0].phoneCode).length : 0;
    if (dial.length > best) {
      matches = [country]; // Longer dial code wins: +598 over +59 if both existed.
    } else if (dial.length === best) {
      matches.push(country);
    }
  }

  return matches.find((country) => country.iso2 === preferredIso2.toUpperCase()) ?? matches[0];
}

/** Drops the leading dial code from a format or example string. */
function nationalPart(template: string, phoneCode: string): string {
  return template.startsWith(phoneCode) ? template.slice(phoneCode.length).trim() : template;
}

/** Letters stand for a digit in a format template; everything else is a separator. */
function isPlaceholder(char: string): boolean {
  return /[A-Za-z]/.test(char);
}
