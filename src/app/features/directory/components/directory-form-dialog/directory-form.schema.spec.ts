import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { describe, expect, it } from 'vitest';
import { DirectoryFormModel, toFormModel } from '../../data-access/directory-forms';
import { attributeValueError, directoryFormSchema } from './directory-form.schema';

function buildForm(model: DirectoryFormModel) {
  const state = signal(model);
  return TestBed.runInInjectionContext(() => form(state, directoryFormSchema));
}

describe('directoryFormSchema', () => {
  /** El alta de los tres tipos de empleado no guarda sin usuario y contraseña. */
  it('does not let an employee be saved without username and password', () => {
    const tree = buildForm({ ...toFormModel('SELLER', null), name: 'Mariela Godoy' });

    expect(tree().valid()).toBe(false);
    expect(
      tree.access
        .username()
        .errors()
        .map((error) => error.kind),
    ).toContain('required');
    expect(
      tree.access
        .password()
        .errors()
        .map((error) => error.kind),
    ).toContain('required');
  });

  it('asks nothing of the access block while the customer switch is off', () => {
    const tree = buildForm({ ...toFormModel('CUSTOMER', null), name: 'Kiosco La Esquina' });

    expect(tree().valid()).toBe(true);
  });

  it('asks for a password when the customer switch is turned on', () => {
    const model = toFormModel('CUSTOMER', null);
    const tree = buildForm({
      ...model,
      name: 'Kiosco La Esquina',
      access: { ...model.access, enabled: true, username: 'kiosco' },
    });

    expect(tree().valid()).toBe(false);
    expect(
      tree.access
        .password()
        .errors()
        .map((error) => error.kind),
    ).toContain('required');
  });

  /** Vincular el usuario que la persona ya tiene no pide contraseña: no se crea ninguno. */
  it('asks for no credential when linking an existing user', () => {
    const model = toFormModel('TRANSPORTIST', null);
    const tree = buildForm({
      ...model,
      name: 'Héctor Quiroga',
      access: { ...model.access, existingUserUuid: 'user-hector', existingUsername: 'hquiroga' },
    });

    expect(tree().valid()).toBe(true);
  });

  it('keeps the seller commission between 0 and 100', () => {
    const model = toFormModel('SELLER', null);
    const base = {
      ...model,
      name: 'Ignacio Roldán',
      access: { ...model.access, existingUserUuid: 'user-ignacio' },
    };

    expect(buildForm({ ...base, commissionRate: 101 })().valid()).toBe(false);
    expect(buildForm({ ...base, commissionRate: 3.5 })().valid()).toBe(true);
  });
});

describe('attributeValueError', () => {
  it('anticipates the shape of each type and lets an empty value through', () => {
    expect(attributeValueError('number', '12')).toBeNull();
    expect(attributeValueError('number', '1.5')?.kind).toBe('attributeNumber');
    expect(attributeValueError('decimal', '3,25')).toBeNull();
    expect(attributeValueError('date', '14/09/2026')?.kind).toBe('attributeDate');
    expect(attributeValueError('date', '')).toBeNull();
  });
});
