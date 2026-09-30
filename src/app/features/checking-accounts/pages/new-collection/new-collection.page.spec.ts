import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { AllocationPreviewDto } from '../../data-access/checking-account.model';
import { CheckingAccountPolicyDto } from '../../data-access/checking-account-policy.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import { NewCollectionPage } from './new-collection.page';

const ACCOUNT_UUID = 'account-uuid';

const ACCOUNTS = {
  content: [
    {
      uuid: ACCOUNT_UUID,
      partyRoleUuid: 'role-uuid',
      partyRole: { uuid: 'role-uuid', name: 'Distribuidora Sur', role: 'CUSTOMER' },
      partyUuid: 'party-uuid',
      balance: 1210,
      overdueAmount: 300,
      enabled: true,
      version: 1,
    },
  ],
  totalCount: 1,
};

const METHODS = {
  content: [
    { uuid: 'cash-uuid', name: 'Efectivo', code: 'CASH', affectsCashRegister: true },
    { uuid: 'transfer-uuid', name: 'Transferencia', code: 'TRANSFER', affectsCashRegister: false },
    // El medio que la pantalla no tiene que ofrecer: cobrar una deuda de cuenta corriente con
    // «cuenta corriente» seria pagarla con ella misma.
    {
      uuid: 'account-method',
      name: 'Cuenta corriente',
      code: 'ACCOUNT',
      affectsCashRegister: false,
    },
  ],
  totalCount: 3,
};

const PREVIEW: AllocationPreviewDto = {
  amount: 500,
  allocatedAmount: 500,
  surplusAmount: 0,
  lines: [
    {
      debtUuid: 'debt-1',
      publicId: '0001-00000042',
      description: 'Venta 0001-00000042',
      dateDue: '2026-09-30',
      pendingAmount: 1210,
      amount: 500,
      remainingAmount: 710,
    },
  ],
};

/** Caja preasignada, con o sin sesion abierta. */
const entryContext = (open: boolean) => ({
  cashRegister: {
    uuid: 'cash-register-uuid',
    name: 'Caja 1',
    openSession: open ? { sessionState: 'OPEN' } : null,
  },
  autoEnter: true,
  requiresOpeningAmount: !open,
  alreadyInSession: open,
});

/** La politica del titular sin override propio: el modo que rige lo decide la empresa. */
const policyWith = (allocationMode: 'AUTOMATIC' | 'MANUAL'): CheckingAccountPolicyDto => ({
  uuid: null,
  version: 0,
  accountUuid: ACCOUNT_UUID,
  dueDaysMode: 'INHERIT',
  dueDays: null,
  debtLimitMode: 'INHERIT',
  debtLimitAmount: null,
  allocationMode: 'INHERIT',
  resolved: {
    dueDays: 30,
    dueDaysSource: 'DEFAULT',
    debtLimit: null,
    debtLimitSource: 'DEFAULT',
    allocationMode,
    allocationModeSource: 'COMPANY',
  },
  reprocess: null,
});

/** Las deudas abiertas del titular, en orden de vencimiento — el mismo del FIFO. */
const OPEN_DEBTS = [
  {
    uuid: 'debt-1',
    accountUuid: ACCOUNT_UUID,
    publicId: '0001-00000042',
    origin: 'ORDER',
    state: 'VENCIDA',
    amount: 1210,
    pendingAmount: 1210,
    dateIssued: '2026-08-01T10:15:00.000',
    dateDue: '2026-09-30',
    dateDueOriginal: '2026-09-30',
    dateVoided: null,
    description: 'Venta 0001-00000042',
  },
];

describe('NewCollectionPage', () => {
  let fixture: ComponentFixture<NewCollectionPage>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const create = (options: { sessionOpen?: boolean } = {}): void => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        // Comodin: al cobrar, la pantalla navega a la cuenta. Sin una ruta que matchee, el
        // router rechaza la navegacion y el rechazo aparece como error suelto de la corrida.
        provideRouter([{ path: '**', children: [] }]),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(NewCollectionPage);
    fixture.detectChanges();

    http.expectOne(apiUrl(API_ENDPOINTS.PAYMENT_METHODS.PAGINATE)).flush(METHODS);
    http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.PAGINATE)).flush(ACCOUNTS);
    http
      .expectOne(apiUrl(API_ENDPOINTS.CASH_REGISTERS.ENTRY_CONTEXT))
      .flush(entryContext(options.sessionOpen ?? true));
    fixture.detectChanges();
  };

  /**
   * Relojes falsos en todo el archivo: la previa se pide con `debounceTime(300)` y sin control del
   * tiempo la peticion queda pendiente al terminar el test, que es lo que `http.verify()` denuncia.
   * El proyecto es zoneless, asi que `fakeAsync` no esta disponible.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  /** Contesta las deudas abiertas del titular, que son las que el reparto a mano ofrece. */
  const answerDebts = (debts: readonly object[]): void => {
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`))
      .flush({ content: debts, totalCount: debts.length });
  };

  /** Contesta la politica del titular, que dice que modo va primero. Con `null`, la lectura falla. */
  const answerPolicy = (policy: CheckingAccountPolicyDto | null): void => {
    const request = http.expectOne(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.ACCOUNT_POLICY_SUFFIX,
      ),
    );
    if (policy) {
      request.flush(policy);
    } else {
      request.flush(null, { status: 500, statusText: 'Server Error' });
    }
  };

  /**
   * Elegir el titular pide tres cosas: la previa —con debounce—, sus deudas abiertas y su politica.
   * Las dos ultimas salen al instante y hay que contestarlas.
   */
  const selectAccount = (
    debts: readonly object[] = OPEN_DEBTS,
    policy: CheckingAccountPolicyDto | null = policyWith('AUTOMATIC'),
  ): void => {
    fixture.componentInstance['onAccountChange'](ACCOUNT_UUID);
    answerDebts(debts);
    answerPolicy(policy);
    fixture.detectChanges();
  };

  /** Las opciones del selector de modo, en el orden en que se ven. */
  const modeToggles = (): HTMLElement[] => Array.from(host().querySelectorAll('mat-button-toggle'));

  /** Deja pasar el debounce de la previa y resuelve la peticion que dispara. */
  const settlePreview = (preview: AllocationPreviewDto | null = PREVIEW): void => {
    vi.advanceTimersByTime(300);
    if (preview) {
      http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PREVIEW)).flush(preview);
    }
    fixture.detectChanges();
  };

  /**
   * El medio «cuenta corriente» no se ofrece: seria pagar una deuda con la misma deuda. Que el
   * backend lo rechace es la validacion; que no llegue a aparecer es cortesia.
   */
  it('no ofrece el medio cuenta corriente', () => {
    create();

    const methods = fixture.componentInstance['paymentMethods']();
    expect(methods.map((method) => method.code)).toEqual(['CASH', 'TRANSFER']);
  });

  /**
   * El aviso de caja llega al elegir el medio, no al confirmar: enterarse con el formulario entero
   * cargado es la clase de error que se paga tipeando todo de nuevo.
   */
  it('avisa que falta sesion de caja apenas el medio la toca, no al confirmar', () => {
    create({ sessionOpen: false });

    // El efectivo viene preseleccionado —es el caso del mostrador—, asi que el aviso esta desde que
    // se abre la pantalla: antes incluso de que alguien elija nada.
    expect(fixture.componentInstance['missingCashSession']()).toBe(true);
    expect(host().textContent).toContain('checkingAccounts.newCollection.noCashSession');

    // Y se va solo si el cobro pasa a entrar por un medio que no toca caja.
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.detectChanges();

    expect(fixture.componentInstance['missingCashSession']()).toBe(false);
    expect(host().textContent).not.toContain('checkingAccounts.newCollection.noCashSession');
  });

  /** Un medio que no toca caja no necesita sesion, asi que no hay aviso. */
  it('no avisa nada si el cobro entra por transferencia', () => {
    create({ sessionOpen: false });

    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.detectChanges();

    expect(fixture.componentInstance['missingCashSession']()).toBe(false);
  });

  /**
   * La previa la calcula el backend. La pantalla no replica el FIFO: con dos implementaciones de la
   * misma regla, la promesa de que la previa coincide con lo imputado dura hasta que alguien toque
   * una de las dos.
   */
  it('pide la previa al backend y la pinta', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    fixture.detectChanges();

    vi.advanceTimersByTime(300);
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PREVIEW));
    expect(request.request.body).toEqual({ accountUuid: ACCOUNT_UUID, amount: 500 });
    request.flush(PREVIEW);
    fixture.detectChanges();

    expect(host().textContent).toContain('0001-00000042');
    // Y la marca como simulacion: sin el recuadro, la tabla se lee como algo que ya quedo imputado.
    expect(host().querySelector('[role="note"]')?.textContent).toContain(
      'checkingAccounts.newCollection.previewSimulation',
    );
  });

  /**
   * El importe no viaja: el backend lo deriva de la suma de los medios. Mandarlo aparte abriria la
   * unica forma de que un cobro diga que entraron $100.000 mientras sus medios suman $90.000.
   */
  it('registra el cobro sin mandar el importe', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    fixture.detectChanges();
    settlePreview();

    fixture.componentInstance['onSubmit'](new Event('submit'));

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT));
    expect(request.request.body.amount).toBeUndefined();
    expect(request.request.body.payments).toEqual([
      { paymentMethodUuid: 'transfer-uuid', amount: 500 },
    ]);
    // Un cobro por transferencia no pasa por ninguna caja: mandarla seria inventar el dato.
    expect(request.request.body.cashRegisterUuid).toBeUndefined();
    request.flush({ uuid: 'credit-uuid', allocations: [] });
  });

  /** El efectivo si manda la caja: es la que va a recibir el movimiento. */
  it('manda la caja cuando el medio toca caja', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'cash-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    fixture.detectChanges();
    settlePreview();

    fixture.componentInstance['onSubmit'](new Event('submit'));

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT));
    expect(request.request.body.cashRegisterUuid).toBe('cash-register-uuid');
    request.flush({ uuid: 'credit-uuid', allocations: [] });
  });

  /* ─────────────────────  El modo que va primero  ───────────────────── */

  /**
   * Va primero —y elegido— el modo que rige para el titular. Con la politica en manual el backend no
   * corre el FIFO, y ofrecer automatico primero invitaria a cobrar con un reparto que no va a pasar.
   */
  it('ofrece primero, y elegido, el modo que rige para el titular', () => {
    create();

    selectAccount(OPEN_DEBTS, policyWith('MANUAL'));

    const [first, second] = modeToggles();
    expect(first.textContent).toContain('checkingAccounts.newCollection.modeManual');
    expect(first.classList).toContain('mat-button-toggle-checked');
    expect(second.textContent).toContain('checkingAccounts.newCollection.modeAuto');
  });

  /** Si la politica no se puede leer no se adivina: queda el orden de siempre, automatico primero. */
  it('sin poder leer la politica deja el orden de siempre', () => {
    create();

    selectAccount(OPEN_DEBTS, null);

    const [first, second] = modeToggles();
    expect(first.textContent).toContain('checkingAccounts.newCollection.modeAuto');
    expect(first.classList).toContain('mat-button-toggle-checked');
    expect(second.textContent).toContain('checkingAccounts.newCollection.modeManual');
  });

  /**
   * La politica decide con que modo arranca la pantalla, no con cual termina: si quien cobra eligio
   * antes de que llegara, su eleccion queda.
   */
  it('no pisa el modo que ya eligio quien cobra', () => {
    create();

    fixture.componentInstance['onAccountChange'](ACCOUNT_UUID);
    answerDebts(OPEN_DEBTS);
    // Elige a mano mientras la politica esta en camino, y la politica dice automatico.
    fixture.componentInstance['onAllocationModeChange']('MANUAL');
    answerPolicy(policyWith('AUTOMATIC'));
    fixture.detectChanges();

    expect(fixture.componentInstance['allocationMode']()).toBe('MANUAL');
  });

  /* ─────────────────────  El reparto explicito (1f)  ───────────────────── */

  /**
   * Pasar a manual arranca del reparto que el FIFO haria: es de donde parte cualquier correccion, y
   * empezar de cero obligaria a tipear de nuevo lo que el sistema ya sabe.
   */
  it('al pasar a manual arranca con el reparto del FIFO', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    settlePreview();

    fixture.componentInstance['onAllocationModeChange']('MANUAL');
    fixture.detectChanges();

    expect(fixture.componentInstance['manualAmounts']()).toEqual({ 'debt-1': 500 });
    expect(fixture.componentInstance['manualUnassigned']()).toBe(0);
  });

  /** El reparto a mano tampoco se aplica hasta cobrar, asi que lleva el mismo recuadro. */
  it('marca la simulacion tambien al elegir a mano', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    settlePreview();

    fixture.componentInstance['onAllocationModeChange']('MANUAL');
    fixture.detectChanges();

    expect(host().querySelector('[role="note"]')?.textContent).toContain(
      'checkingAccounts.newCollection.previewSimulation',
    );
  });

  /**
   * El reparto se valida **en bloque** y no linea por linea: dos lineas de $600 sobre un cobro de
   * $1.000 pasarian las dos por separado y lo dejarian en −$200.
   */
  it('no deja confirmar si el reparto supera el cobro', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    settlePreview();

    fixture.componentInstance['onAllocationModeChange']('MANUAL');
    fixture.componentInstance['onManualAmountChange']('debt-1', '900');
    fixture.detectChanges();

    expect(fixture.componentInstance['manualUnassigned']()).toBe(-400);
    expect(fixture.componentInstance['manualValid']()).toBe(false);
    expect(fixture.componentInstance['canSubmit']()).toBe(false);
  });

  /** Y una linea que supera su propio pendiente tambien rebota: son las dos mitades de la regla. */
  it('no deja confirmar si una linea supera el pendiente de su deuda', () => {
    create();

    selectAccount([{ ...OPEN_DEBTS[0], pendingAmount: 300 }]);
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    settlePreview();

    fixture.componentInstance['onAllocationModeChange']('MANUAL');
    fixture.componentInstance['onManualAmountChange']('debt-1', '400');
    fixture.detectChanges();

    // Sobra plata sin asignar —el cobro es de 500— pero la linea se pasa de lo que la deuda debe.
    expect(fixture.componentInstance['manualUnassigned']()).toBe(100);
    expect(fixture.componentInstance['manualOverflow']()).toHaveLength(1);
    expect(fixture.componentInstance['manualValid']()).toBe(false);
  });

  /**
   * El reparto viaja en el **mismo request** que el cobro: cobrar primero y corregir despues dejaria
   * al FIFO aplicar la plata en el medio.
   */
  it('manda el reparto explicito junto con el cobro', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    settlePreview();

    fixture.componentInstance['onAllocationModeChange']('MANUAL');
    fixture.componentInstance['onManualAmountChange']('debt-1', '300');
    fixture.detectChanges();

    fixture.componentInstance['onSubmit'](new Event('submit'));

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT));
    expect(request.request.body.allocations).toEqual([{ debtUuid: 'debt-1', amount: 300 }]);
    request.flush({ uuid: 'credit-uuid', allocations: [] });
  });

  /** En automatico no viaja reparto, y su ausencia es lo que deja correr el FIFO. */
  it('en automatico no manda reparto', () => {
    create();

    selectAccount();
    fixture.componentInstance['onPaymentMethodChange'](1, 'transfer-uuid');
    fixture.componentInstance['onPaymentAmountChange'](1, '500');
    settlePreview();

    fixture.componentInstance['onSubmit'](new Event('submit'));

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT));
    expect(request.request.body.allocations).toBeUndefined();
    request.flush({ uuid: 'credit-uuid', allocations: [] });
  });
});
