import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BRANCH_UUID_KEY,
  CASH_REGISTER_KEY_PREFIX,
  COMPANY_UUID_KEY,
  TAB_SEALED_KEY,
} from './tab-context-keys.constants';
import { TabContextStore } from './tab-context.store';

/**
 * Lo que se comprueba acá es el aislamiento: qué hereda un tab al abrirse y qué deja de verle a los
 * demás una vez que fijó lo suyo. Los otros tabs se simulan escribiendo la semilla —el localStorage
 * compartido— a mano, que es exactamente lo que hacen ellos al persistir su contexto.
 */
describe('TabContextStore', () => {
  /** El tab que arranca de cero: instancia nueva sin nada propio todavía. */
  const openTab = (): TabContextStore => {
    TestBed.resetTestingModule();
    return TestBed.inject(TabContextStore);
  };

  beforeEach(() => {
    localStorage.setItem(COMPANY_UUID_KEY, 'empresa');
    localStorage.setItem(BRANCH_UUID_KEY, 'centro');
  });

  it('hereda el contexto de la semilla en la primera lectura', () => {
    const store = openTab();

    expect(store.getCompanyUuid()).toBe('empresa');
    expect(store.getBranchUuid()).toBe('centro');
  });

  /** El caso que motivó todo: dos tabs abiertos, uno cambia de sucursal, el otro no se mueve. */
  it('no se entera de lo que otro tab elige después', () => {
    const store = openTab();
    store.getBranchUuid();

    localStorage.setItem(BRANCH_UUID_KEY, 'norte');

    expect(store.getBranchUuid()).toBe('centro');
  });

  /** Tab duplicado o abierto con Ctrl+clic: el navegador le copia el `sessionStorage` de origen. */
  it('prefiere lo que el tab ya trae sobre la semilla', () => {
    sessionStorage.setItem(BRANCH_UUID_KEY, 'sur');

    expect(openTab().getBranchUuid()).toBe('sur');
  });

  it('escribe el valor del tab y actualiza la semilla', () => {
    openTab().setBranchUuid('norte');

    expect(sessionStorage.getItem(BRANCH_UUID_KEY)).toBe('norte');
    expect(localStorage.getItem(BRANCH_UUID_KEY)).toBe('norte');
  });

  /** Un contexto que dejó de ser válido no es algo que convenga heredarle al próximo tab. */
  it('borra de los dos lados', () => {
    const store = openTab();

    store.removeBranchUuid();

    expect(sessionStorage.getItem(BRANCH_UUID_KEY)).toBeNull();
    expect(localStorage.getItem(BRANCH_UUID_KEY)).toBeNull();
  });

  /**
   * El sello vive en `sessionStorage` justamente por esto: sin él, la recarga volvería a heredar la
   * sucursal que el tab acababa de descartar, y saldría en el header de la empresa equivocada.
   */
  it('no vuelve a heredar después de una recarga', () => {
    const store = openTab();
    store.removeBranchUuid();
    localStorage.setItem(BRANCH_UUID_KEY, 'norte');

    // La recarga: se pierde la instancia y su memoria, sobrevive el `sessionStorage` del tab.
    expect(openTab().getBranchUuid()).toBeNull();
  });

  it('hereda también la caja recordada de cada sucursal', () => {
    localStorage.setItem(`${CASH_REGISTER_KEY_PREFIX}centro`, 'caja-1');
    localStorage.setItem(`${CASH_REGISTER_KEY_PREFIX}norte`, 'caja-2');

    const store = openTab();

    expect(store.getItem(`${CASH_REGISTER_KEY_PREFIX}centro`)).toBe('caja-1');
    expect(store.getItem(`${CASH_REGISTER_KEY_PREFIX}norte`)).toBe('caja-2');
  });

  /** Se hereda el grupo entero de una vez: mitades de contextos distintos no se mezclan. */
  it('sella el contexto completo en la primera lectura, sea cual sea', () => {
    openTab().getCompanyUuid();

    localStorage.setItem(BRANCH_UUID_KEY, 'norte');

    expect(sessionStorage.getItem(BRANCH_UUID_KEY)).toBe('centro');
    expect(sessionStorage.getItem(TAB_SEALED_KEY)).not.toBeNull();
  });

  /** Cerrar sesión no le borra al operador la caja que tenía elegida; hoy tampoco lo hacía. */
  it('deja las cajas en pie al limpiar la sesión', () => {
    localStorage.setItem(`${CASH_REGISTER_KEY_PREFIX}centro`, 'caja-1');
    const store = openTab();

    store.clear();

    expect(store.getCompanyUuid()).toBeNull();
    expect(store.getBranchUuid()).toBeNull();
    expect(store.getItem(`${CASH_REGISTER_KEY_PREFIX}centro`)).toBe('caja-1');
  });
});
