import {
  SchemaPath,
  ValidationError,
  email,
  maxDate,
  maxLength,
  minDate,
  minLength,
  required,
  validate,
} from '@angular/forms/signals';
import { resolvePhoneCode } from './phone-codes';
import { NATIONAL_MIN_DIGITS, PhoneValue, digitsOf, maxNationalDigits } from './phone-number';

/**
 * Validators for Signal Forms (`@angular/forms/signals`).
 *
 * They are plain functions so they read like the built-in ones inside a schema:
 *
 * ```ts
 * form(this.model, (path) => {
 *   code(path.code, { length: 6 });
 *   password(path.password);
 *   passwordMatch(path.confirmPassword, path.password);
 * });
 * ```
 *
 * Every error `kind` produced here has a matching `validation.{kind}` translation
 * so `FieldErrorPipe` can resolve it.
 *
 * Only rules the framework does not already cover live here. `minDate`, `maxDate`,
 * `min`, `max`, `minLength`, `maxLength`, `pattern`, `email` and `required` are
 * built in — import those straight from `@angular/forms/signals`.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 20;

export const EMAIL_MAX_LENGTH = 200;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 100;

/** Character classes a password must contain, in the order they are reported. */
const PASSWORD_CHARACTER_RULES: readonly { readonly kind: string; readonly test: RegExp }[] = [
  { kind: 'requiredUppercaseChar', test: /[A-Z]/ },
  { kind: 'requiredLowercaseChar', test: /[a-z]/ },
  { kind: 'requiredNumberChar', test: /\d/ },
  { kind: 'requiredSpecialChar', test: /[@$!%*?&]/ },
];

/** Character sets accepted by a code/OTP field. */
export type CodeCharset = 'numeric' | 'alphanumeric';

/**
 * Matches a single accepted character. Kept without the `g` flag so the regexes
 * stay stateless and can be reused for both validation and input filtering.
 */
export const CODE_CHARSET_CHARS: Record<CodeCharset, RegExp> = {
  numeric: /[0-9]/,
  alphanumeric: /[0-9A-Za-z]/,
};

export interface CodeLengthValidationError extends ValidationError {
  readonly kind: 'codeLength';
  /** Number of characters the code must have. */
  readonly length: number;
}

export interface CodeOptions {
  /** Exact number of characters the code must have. */
  length: number;
  /** Accepted characters. Defaults to `alphanumeric`. */
  charset?: CodeCharset;
}

/**
 * Requires a complete code of exactly `length` characters taken from `charset`.
 *
 * @param path - The code field path.
 * @param options - Expected length and character set.
 */
export function code(path: SchemaPath<string>, options: CodeOptions): void {
  const allowed = CODE_CHARSET_CHARS[options.charset ?? 'alphanumeric'];

  required(path);

  validate(path, ({ value }) => {
    const current = value();
    if (!current) {
      return null; // `required` already reports the empty case.
    }

    const errors: ValidationError[] = [];

    if (current.length !== options.length) {
      const lengthError: CodeLengthValidationError = {
        kind: 'codeLength',
        length: options.length,
      };
      errors.push(lengthError);
    }

    if (![...current].every((char) => allowed.test(char))) {
      errors.push({ kind: 'codeFormat' });
    }

    return errors;
  });
}

export interface PhoneNumberOptions {
  /** Whether an empty number reports `required`. Defaults to `true`. */
  required?: boolean;
}

/**
 * Requires a phone number the selected country could actually carry.
 *
 * Length is checked against the E.164 limit rather than against the country
 * format, which only describes one of the lengths a country uses.
 *
 * @param path - The phone field path.
 * @param options - Whether the field is required.
 */
export function phoneNumber(path: SchemaPath<PhoneValue>, options: PhoneNumberOptions = {}): void {
  const isRequired = options.required ?? true;

  validate(path, ({ value }) => {
    const digits = digitsOf(value().nationalNumber);
    if (!digits) {
      // The value is an object, so the built-in `required` never sees it as empty.
      return isRequired ? { kind: 'required' } : null;
    }

    const country = resolvePhoneCode(value().iso2);
    const withinBounds =
      digits.length >= NATIONAL_MIN_DIGITS && digits.length <= maxNationalDigits(country);

    return withinBounds ? null : { kind: 'phoneNumber' };
  });
}

/**
 * Applies the app-wide password policy: length bounds plus one uppercase,
 * lowercase, number and special character.
 *
 * @param path - The password field path.
 */
export function password(path: SchemaPath<string>): void {
  required(path);
  minLength(path, PASSWORD_MIN_LENGTH);
  maxLength(path, PASSWORD_MAX_LENGTH);

  validate(path, ({ value }) => {
    const current = value();
    if (!current) {
      return null;
    }

    return PASSWORD_CHARACTER_RULES.filter((rule) => !rule.test.test(current)).map((rule) => ({
      kind: rule.kind,
    }));
  });
}

/**
 * Requires the field to repeat the value of another field.
 *
 * Unlike the Reactive Forms version this validator lives on the confirmation
 * field itself, so the error surfaces exactly where the user has to fix it.
 *
 * @param path - The confirmation field path.
 * @param passwordPath - The path of the password being confirmed.
 */
export function passwordMatch(path: SchemaPath<string>, passwordPath: SchemaPath<string>): void {
  validate(path, ({ value, valueOf }) => {
    const confirmation = value();
    if (!confirmation) {
      return null; // Nothing typed yet; `required` owns that message.
    }

    return confirmation === valueOf(passwordPath) ? null : { kind: 'passwordMatch' };
  });
}

/**
 * Applies the app-wide email policy.
 *
 * Named `emailAddress` because `email` is already a built-in Signal Forms
 * validator; this one bundles it with `required` and a length bound.
 *
 * @param path - The email field path.
 */
export function emailAddress(path: SchemaPath<string>): void {
  required(path);
  email(path);
  maxLength(path, EMAIL_MAX_LENGTH);
}

/**
 * Applies the app-wide username policy.
 *
 * @param path - The username field path.
 */
export function username(path: SchemaPath<string>): void {
  required(path);
  minLength(path, USERNAME_MIN_LENGTH);
  maxLength(path, USERNAME_MAX_LENGTH);
}

/**
 * Requires the date to fall between `min` and `max` (inclusive).
 *
 * Reports the built-in `minDate` / `maxDate` errors rather than a single
 * `dateRange` one, so the message can name the bound that was crossed.
 *
 * @param path - The date field path.
 * @param min - Earliest accepted date.
 * @param max - Latest accepted date. Defaults to today.
 */
export function dateRange(path: SchemaPath<Date | null>, min: Date, max?: Date): void {
  minDate(path, startOfDay(min));
  maxDate(path, endOfDay(max ?? new Date()));
}

/**
 * Requires the date to be strictly after today.
 *
 * @param path - The date field path.
 */
export function futureDate(path: SchemaPath<Date | null>): void {
  validate(path, ({ value }) => {
    const selected = value();
    if (!selected) {
      return null;
    }

    return selected > endOfDay(new Date()) ? null : { kind: 'futureDate' };
  });
}

export interface MinAgeValidationError extends ValidationError {
  readonly kind: 'minAge';
  /** Minimum required age in years. */
  readonly min: number;
}

export interface MaxAgeValidationError extends ValidationError {
  readonly kind: 'maxAge';
  /** Maximum allowed age in years. */
  readonly max: number;
}

/**
 * Requires the birth date to represent an age of at least `years`.
 *
 * @param path - The birth date field path.
 * @param years - Minimum required age in years.
 */
export function minAge(path: SchemaPath<Date | null>, years: number): void {
  validate(path, ({ value }) => {
    const birthDate = value();
    if (!birthDate || ageInYears(birthDate) >= years) {
      return null;
    }

    const error: MinAgeValidationError = { kind: 'minAge', min: years };
    return error;
  });
}

/**
 * Requires the birth date to represent an age of at most `years`.
 *
 * @param path - The birth date field path.
 * @param years - Maximum allowed age in years.
 */
export function maxAge(path: SchemaPath<Date | null>, years: number): void {
  validate(path, ({ value }) => {
    const birthDate = value();
    if (!birthDate || ageInYears(birthDate) <= years) {
      return null;
    }

    const error: MaxAgeValidationError = { kind: 'maxAge', max: years };
    return error;
  });
}

/** Completed years between `birthDate` and today. */
function ageInYears(birthDate: Date, today = new Date()): number {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  return age;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);

  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);

  return copy;
}
