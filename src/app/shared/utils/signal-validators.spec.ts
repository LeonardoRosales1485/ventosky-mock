import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ValidationError, form } from '@angular/forms/signals';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  code,
  dateRange,
  emailAddress,
  futureDate,
  maxAge,
  minAge,
  password,
  passwordMatch,
  username,
} from './signal-validators';

/** Minimal shape needed to read a single field's errors, whatever its value type is. */
interface SingleFieldTree {
  field: () => { errors: () => readonly ValidationError[] };
}

/** Builds a single-field form and returns the error kinds it reports for `value`. */
function kindsFor<T>(value: T, apply: (path: never) => void): string[] {
  const model = signal({ field: value });
  const tree = TestBed.runInInjectionContext(() =>
    form(model, (path) => apply(path.field as never)),
  );

  return (tree as unknown as SingleFieldTree)
    .field()
    .errors()
    .map((error) => error.kind);
}

function yearsAgo(years: number, dayOffset = 0): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setDate(date.getDate() + dayOffset);

  return date;
}

describe('signal validators', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  describe('code', () => {
    const apply = (path: never) => code(path, { length: 4 });

    it('requires a value', () => {
      expect(kindsFor('', apply)).toContain('required');
    });

    it('reports an incomplete code', () => {
      expect(kindsFor('12', apply)).toEqual(['codeLength']);
    });

    it('reports characters outside the charset', () => {
      expect(kindsFor('12/4', apply)).toEqual(['codeFormat']);
    });

    it('accepts a complete alphanumeric code', () => {
      expect(kindsFor('3FV2', apply)).toEqual([]);
    });

    it('rejects letters when the charset is numeric', () => {
      const numeric = (path: never) => code(path, { length: 4, charset: 'numeric' });

      expect(kindsFor('3FV2', numeric)).toEqual(['codeFormat']);
      expect(kindsFor('3472', numeric)).toEqual([]);
    });

    it('carries the expected length so the message can name it', () => {
      const model = signal({ field: '12' });
      const field = TestBed.runInInjectionContext(() =>
        form(model, (path) => code(path.field, { length: 4 })),
      );

      expect(field.field().errors()[0]).toMatchObject({ kind: 'codeLength', length: 4 });
    });
  });

  describe('password', () => {
    it('reports every missing character class at once', () => {
      expect(kindsFor('abcdefgh', password)).toEqual([
        'requiredUppercaseChar',
        'requiredNumberChar',
        'requiredSpecialChar',
      ]);
    });

    it('enforces the length bounds', () => {
      expect(kindsFor('Ab1!', password)).toContain('minLength');
      expect(kindsFor(`Ab1!${'a'.repeat(20)}`, password)).toContain('maxLength');
    });

    it('accepts a compliant password', () => {
      expect(kindsFor('Str0ng!Pass', password)).toEqual([]);
    });
  });

  describe('passwordMatch', () => {
    it('reports a mismatch on the confirmation field', () => {
      const model = signal({ password: 'Str0ng!Pass', confirmPassword: 'Str0ng!Pas' });
      const field = TestBed.runInInjectionContext(() =>
        form(model, (path) => passwordMatch(path.confirmPassword, path.password)),
      );

      expect(
        field
          .confirmPassword()
          .errors()
          .map((e) => e.kind),
      ).toEqual(['passwordMatch']);
      expect(field.password().errors()).toEqual([]);
    });

    it('clears once both fields agree', () => {
      const model = signal({ password: 'Str0ng!Pass', confirmPassword: 'Str0ng!Pass' });
      const field = TestBed.runInInjectionContext(() =>
        form(model, (path) => passwordMatch(path.confirmPassword, path.password)),
      );

      expect(field.confirmPassword().errors()).toEqual([]);
    });
  });

  describe('emailAddress', () => {
    it('requires a well-formed address', () => {
      expect(kindsFor('', emailAddress)).toContain('required');
      expect(kindsFor('nope', emailAddress)).toContain('email');
      expect(kindsFor('user@example.com', emailAddress)).toEqual([]);
    });

    it('caps the length', () => {
      expect(kindsFor(`${'a'.repeat(200)}@example.com`, emailAddress)).toContain('maxLength');
    });
  });

  describe('username', () => {
    it('enforces the length bounds', () => {
      expect(kindsFor('ab', username)).toContain('minLength');
      expect(kindsFor('a'.repeat(101), username)).toContain('maxLength');
      expect(kindsFor('josue', username)).toEqual([]);
    });
  });

  describe('minAge / maxAge', () => {
    it('counts completed years, not calendar years', () => {
      // Turns 18 tomorrow.
      expect(kindsFor(yearsAgo(18, 1), (p) => minAge(p, 18))).toEqual(['minAge']);
      // Turned 18 yesterday.
      expect(kindsFor(yearsAgo(18, -1), (p) => minAge(p, 18))).toEqual([]);
    });

    it('reports the bound so the message can name it', () => {
      const model = signal({ field: yearsAgo(10) as Date | null });
      const field = TestBed.runInInjectionContext(() =>
        form(model, (path) => minAge(path.field, 18)),
      );

      expect(field.field().errors()[0]).toMatchObject({ kind: 'minAge', min: 18 });
    });

    it('caps the age', () => {
      expect(kindsFor(yearsAgo(70), (p) => maxAge(p, 65))).toEqual(['maxAge']);
      expect(kindsFor(yearsAgo(60), (p) => maxAge(p, 65))).toEqual([]);
    });

    it('ignores an empty value', () => {
      expect(kindsFor(null, (p) => minAge(p, 18))).toEqual([]);
    });
  });

  describe('futureDate', () => {
    it('rejects today and the past but accepts tomorrow', () => {
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(kindsFor(today, futureDate)).toEqual(['futureDate']);
      expect(kindsFor(tomorrow, futureDate)).toEqual([]);
      expect(kindsFor(null, futureDate)).toEqual([]);
    });
  });

  describe('dateRange', () => {
    it('reports which bound was crossed', () => {
      const min = new Date(2020, 0, 10);
      const max = new Date(2020, 0, 20);
      const apply = (path: never) => dateRange(path, min, max);

      expect(kindsFor(new Date(2020, 0, 9), apply)).toEqual(['minDate']);
      expect(kindsFor(new Date(2020, 0, 21), apply)).toEqual(['maxDate']);
      // The bounds themselves are inclusive at day granularity.
      expect(kindsFor(new Date(2020, 0, 10, 8), apply)).toEqual([]);
      expect(kindsFor(new Date(2020, 0, 20, 23), apply)).toEqual([]);
    });
  });
});
