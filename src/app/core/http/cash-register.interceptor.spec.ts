import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelectedCashRegisterStore } from '../cash-session/selected-cash-register.store';
import {
  BRANCH_UUID_KEY,
  CASH_REGISTER_KEY_PREFIX,
} from '../tab-context/tab-context-keys.constants';
import { cashRegisterInterceptor } from './cash-register.interceptor';

describe('cashRegisterInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  /** Dispara un request cualquiera y devuelve el que llegó al backend, ya interceptado. */
  const send = (headers?: Record<string, string>) => {
    http.get('/probe', { headers }).subscribe();
    return controller.expectOne('/probe').request;
  };

  /** Se siembra por el store y no escribiendo la clave a mano: su formato es asunto suyo. */
  const remember = (branchUuid: string, cashRegisterUuid: string): void => {
    TestBed.inject(SelectedCashRegisterStore).write(branchUuid, cashRegisterUuid);
  };

  beforeEach(() => {
    // La sucursal del tab se hereda de la semilla, que es lo que hay al abrir la aplicación.
    localStorage.setItem(BRANCH_UUID_KEY, 'centro');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([cashRegisterInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
  });

  it('attaches the cash register remembered for the active branch', () => {
    remember('centro', 'caja-1');

    expect(send().headers.get('X-Cash-Register-Uuid')).toBe('caja-1');
  });

  /** Sin caja resuelta no hay nada que mandar, y un header vacío no es lo mismo que ausente. */
  it('sends no header when the branch has no cash register', () => {
    expect(send().headers.has('X-Cash-Register-Uuid')).toBe(false);
  });

  /** Una caja pertenece a una sucursal: la de otra el backend la rechazaría por no ser suya. */
  it('ignores the cash register remembered for another branch', () => {
    remember('norte', 'caja-9');

    expect(send().headers.has('X-Cash-Register-Uuid')).toBe(false);
  });

  /** Dos tabs pueden estar en la misma sucursal con cajas distintas: cada uno manda la suya. */
  it('ignores the cash register another tab picked afterwards', () => {
    remember('centro', 'caja-1');
    localStorage.setItem(`${CASH_REGISTER_KEY_PREFIX}centro`, 'caja-9');

    expect(send().headers.get('X-Cash-Register-Uuid')).toBe('caja-1');
  });

  it('respects a header the caller set explicitly', () => {
    remember('centro', 'caja-1');

    expect(send({ 'X-Cash-Register-Uuid': 'caja-7' }).headers.get('X-Cash-Register-Uuid')).toBe(
      'caja-7',
    );
  });
});
