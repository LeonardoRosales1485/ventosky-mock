import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  CheckingAccountPolicyDto,
  PolicyPreviewDto,
} from '../../data-access/checking-account-policy.model';
import { CheckingAccountPolicyPage } from './checking-account-policy.page';

function policy(overrides: Partial<CheckingAccountPolicyDto['resolved']> = {}) {
  return {
    uuid: 'policy-uuid',
    version: 1,
    accountUuid: null,
    dueDaysMode: 'VALUE',
    dueDays: 30,
    debtLimitMode: 'AMOUNT',
    debtLimitAmount: 100000,
    allocationMode: 'AUTOMATIC',
    resolved: {
      dueDays: 30,
      dueDaysSource: 'COMPANY',
      debtLimit: 100000,
      debtLimitSource: 'COMPANY',
      allocationMode: 'AUTOMATIC',
      allocationModeSource: 'COMPANY',
      ...overrides,
    },
    reprocess: null,
  } as CheckingAccountPolicyDto;
}

describe('CheckingAccountPolicyPage', () => {
  let fixture: ComponentFixture<CheckingAccountPolicyPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CheckingAccountPolicyPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([{ path: '**', children: [] }]),
        provideTranslateService(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckingAccountPolicyPage);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  function loadWith(dto: CheckingAccountPolicyDto): void {
    http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY)).flush(dto);
    fixture.detectChanges();
  }

  /** Los tres valores salen del `resolved`, que es lo que efectivamente rige. */
  it('carga la politica que rige, con la fuente de cada valor', () => {
    loadWith(policy());
    const component = fixture.componentInstance as unknown as {
      dueDays: () => number | null;
      limitMode: () => string;
      debtLimit: () => number | null;
      allocationMode: () => string;
      dirty: () => boolean;
    };

    expect(component.dueDays()).toBe(30);
    expect(component.limitMode()).toBe('AMOUNT');
    expect(component.debtLimit()).toBe(100000);
    expect(component.allocationMode()).toBe('AUTOMATIC');
    // Recien cargada no hay nada que guardar: sin esto el boton estaria activo desde el arranque.
    expect(component.dirty()).toBe(false);
  });

  /**
   * El criterio de aceptacion del ticket: bajar el limite avisa cuantas cuentas quedan excedidas
   * ANTES de confirmar, y no rechaza ni modifica nada.
   */
  it('al bajar el limite avisa cuantas cuentas quedan excedidas, sin guardar nada', () => {
    loadWith(policy());
    const component = fixture.componentInstance as unknown as {
      debtLimit: (value?: number) => void;
      onFormChange: () => void;
      check: () => void;
      preview: () => PolicyPreviewDto | null;
    };
    (component.debtLimit as unknown as { set: (v: number) => void }).set(50000);
    component.onFormChange();

    component.check();
    const preview: PolicyPreviewDto = { reprocess: null, accountsOverLimit: 7, debtLimit: 50000 };
    http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_PREVIEW)).flush(preview);
    fixture.detectChanges();

    // El numero lo contesta el backend: la pantalla no infiere si el limite baja ni a cuantas
    // cuentas les pega. Con dos implementaciones de la misma regla, una de las dos miente.
    expect(component.preview()?.accountsOverLimit).toBe(7);
    // Y no se guardo nada: `http.verify()` del afterEach falla si hubiera salido un POST al save.
  });

  /**
   * «Pasar a automatico muestra la vista previa, y los numeros del resultado coinciden con los de la
   * previa.» Los dos salen del backend, que corre el mismo reparto: la pantalla no los recalcula.
   */
  it('al pasar a automatico muestra la previa y despues el resultado', () => {
    loadWith(policy({ allocationMode: 'MANUAL', allocationModeSource: 'COMPANY' }));
    const component = fixture.componentInstance as unknown as {
      allocationMode: { set: (v: string) => void };
      onFormChange: () => void;
      check: () => void;
      save: () => void;
      preview: () => PolicyPreviewDto | null;
      result: () => { accounts: number; allocations: number; settledAmount: number } | null;
    };
    component.allocationMode.set('AUTOMATIC');
    component.onFormChange();

    component.check();
    const reprocess = {
      accounts: 3,
      allocations: 5,
      settledAmount: 128400,
      evaluatedAccounts: 412,
      failedAccounts: [],
    };
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_PREVIEW))
      .flush({ reprocess, accountsOverLimit: 0, debtLimit: 100000 } as PolicyPreviewDto);
    fixture.detectChanges();
    expect(component.preview()?.reprocess?.allocations).toBe(5);

    component.save();
    const saved = policy();
    saved.reprocess = reprocess;
    http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_SAVE)).flush(saved);
    fixture.detectChanges();

    // Lo que promete la previa y lo que informa el resultado tienen que ser el mismo numero.
    expect(component.result()?.accounts).toBe(3);
    expect(component.result()?.allocations).toBe(5);
    expect(component.result()?.settledAmount).toBe(128400);
  });

  /**
   * Tocar cualquier campo invalida la previa: mostrarla al lado de otros valores seria decir que
   * pasaria algo que ya no es lo que se esta por guardar.
   */
  it('cualquier cambio invalida la previa', () => {
    loadWith(policy());
    const component = fixture.componentInstance as unknown as {
      debtLimit: { set: (v: number) => void };
      onFormChange: () => void;
      check: () => void;
      preview: () => PolicyPreviewDto | null;
    };
    component.debtLimit.set(50000);
    component.onFormChange();
    component.check();
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_PREVIEW))
      .flush({ reprocess: null, accountsOverLimit: 2, debtLimit: 50000 } as PolicyPreviewDto);
    fixture.detectChanges();
    expect(component.preview()).not.toBeNull();

    component.debtLimit.set(60000);
    component.onFormChange();
    expect(component.preview()).toBeNull();
  });

  /** El guardado manda modos explicitos: la politica de la empresa nunca hereda. */
  it('nunca manda INHERIT: la empresa es el peldano mas alto', () => {
    loadWith(policy());
    const component = fixture.componentInstance as unknown as {
      allocationMode: { set: (v: string) => void };
      onFormChange: () => void;
      save: () => void;
    };
    component.allocationMode.set('MANUAL');
    component.onFormChange();
    component.save();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_SAVE));
    expect(request.request.body.dueDaysMode).toBe('VALUE');
    expect(request.request.body.debtLimitMode).toBe('AMOUNT');
    expect(request.request.body.allocationMode).toBe('MANUAL');
    expect(request.request.body).not.toHaveProperty('uuid');
    request.flush(policy());
  });

  /** «Sin tope» es una decision explicita, y viaja como tal. */
  it('sin tope manda UNLIMITED y no un importe nulo suelto', () => {
    loadWith(policy());
    const component = fixture.componentInstance as unknown as {
      limitMode: { set: (v: string) => void };
      onFormChange: () => void;
      save: () => void;
    };
    component.limitMode.set('UNLIMITED');
    component.onFormChange();
    component.save();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.POLICY_SAVE));
    expect(request.request.body.debtLimitMode).toBe('UNLIMITED');
    expect(request.request.body.debtLimitAmount).toBeNull();
    request.flush(policy());
  });
});
