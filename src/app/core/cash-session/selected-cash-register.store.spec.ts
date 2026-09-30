import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BRANCH_UUID_KEY,
  CASH_REGISTER_KEY_PREFIX,
} from '../tab-context/tab-context-keys.constants';
import { SelectedCashRegisterStore } from './selected-cash-register.store';

describe('SelectedCashRegisterStore', () => {
  let store: SelectedCashRegisterStore;

  beforeEach(() => {
    localStorage.setItem(BRANCH_UUID_KEY, 'centro');
    store = TestBed.inject(SelectedCashRegisterStore);
  });

  it('remembers the cash register of the branch it was picked for', () => {
    store.write('centro', 'caja-1');

    expect(store.read('centro')).toBe('caja-1');
  });

  /** Una caja pertenece a una sucursal: la de otra el backend la rechazaría por no ser suya. */
  it('does not hand over the cash register of another branch', () => {
    store.write('norte', 'caja-9');

    expect(store.current()).toBeNull();
  });

  it('resolves the current one from the branch of this tab', () => {
    store.write('centro', 'caja-1');
    store.write('norte', 'caja-2');

    expect(store.current()).toBe('caja-1');
  });

  /** Dos tabs en la misma sucursal pueden estar cobrando por cajas distintas. */
  it('keeps its own after another tab picks a different one', () => {
    store.write('centro', 'caja-1');
    localStorage.setItem(`${CASH_REGISTER_KEY_PREFIX}centro`, 'caja-9');

    expect(store.current()).toBe('caja-1');
  });

  /** La caja que este tab eligió queda de semilla: el próximo que se abra arranca con ella. */
  it('leaves the pick as the seed for the next tab', () => {
    store.write('centro', 'caja-1');

    expect(localStorage.getItem(`${CASH_REGISTER_KEY_PREFIX}centro`)).toBe('caja-1');
  });

  it('has nothing to remember without a branch', () => {
    store.write(null, 'caja-1');

    expect(store.read(null)).toBeNull();
  });
});
