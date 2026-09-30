import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  CheckingAccountCreditRowDto,
  CheckingAccountDebtRowDto,
  CheckingAccountRowDto,
  StatementEntryRowDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import { CheckingAccountDetailPage } from './checking-account-detail.page';

const ACCOUNT_UUID = 'account-uuid';

const ACCOUNT: CheckingAccountRowDto = {
  uuid: ACCOUNT_UUID,
  partyRoleUuid: 'role-uuid',
  partyRole: {
    uuid: 'role-uuid',
    name: 'Distribuidora Sur',
    docType: 'CUIT',
    docNumber: '30111222333',
    role: 'CUSTOMER',
  },
  partyUuid: 'party-uuid',
  balance: 810,
  oldestOverdueDays: null,
  delinquencyLevel: 'AL_DIA',
  overdueAmount: 300,
  enabled: true,
  version: 2,
};

/** Una deuda de 1210 y un cobro de 400: el acumulado cierra en 810, el saldo del encabezado. */
/**
 * El extracto sale **del movimiento más nuevo al más viejo**, así que el crédito —posterior— va
 * primero y el saldo de la cuenta es el de la **primera** fila. El acumulado, en cambio, se sigue
 * calculando en orden cronológico: por eso el crédito arriba dice 810 y la deuda de abajo, 1210.
 */
const STATEMENT: readonly StatementEntryRowDto[] = [
  {
    entryType: 'CREDIT',
    uuid: 'credit-1',
    publicId: '0002-00000210',
    origin: 'RECEIPT',
    description: 'Recibo 0002-00000210',
    state: 'SIN_IMPUTAR',
    dateIssued: '2026-08-15T09:00:00.000',
    dateVoided: null,
    amount: 400,
    signedAmount: -400,
    runningBalance: 810,
  },
  {
    entryType: 'DEBT',
    uuid: 'debt-1',
    publicId: '0001-00000042',
    origin: 'ORDER',
    description: 'Venta 0001-00000042',
    state: 'VENCIDA',
    dateIssued: '2026-08-01T10:15:00.000',
    dateVoided: null,
    amount: 1210,
    signedAmount: 1210,
    runningBalance: 1210,
  },
];

/**
 * El extracto con la imputacion en el medio: entra la deuda, entra el cobro, y la fila que los une
 * dice a que deuda fue y por cuanto. Sin ella el extracto tenia un agujero justo ahi.
 */
const ALLOCATED_STATEMENT: readonly StatementEntryRowDto[] = [
  {
    entryType: 'ALLOCATION',
    uuid: 'alloc-1',
    publicId: '0002-00000210',
    origin: 'AUTOMATIC',
    description: null,
    state: '0001-00000042',
    dateIssued: '2026-08-15T09:00:01.000',
    dateVoided: null,
    amount: 400,
    signedAmount: 0,
    runningBalance: 810,
  },
  ...STATEMENT,
];

/**
 * El mismo extracto despues de anular el cobro: la partida conserva su importe en su fecha, la
 * anulacion es una fila propia con el signo contrario, y cada imputacion deshecha entra por su
 * cuenta diciendo a que deuda le devolvio cuanto.
 */
const VOIDED_STATEMENT: readonly StatementEntryRowDto[] = [
  {
    entryType: 'REVERSAL',
    uuid: 'rev-1',
    publicId: '0002-00000210',
    origin: 'CREDIT_VOID',
    description: 'Se cargo dos veces el mismo deposito',
    state: '0001-00000042',
    dateIssued: '2026-08-20T11:00:00.000',
    dateVoided: null,
    amount: 400,
    signedAmount: 0,
    runningBalance: 1210,
  },
  {
    entryType: 'CREDIT_VOID',
    uuid: 'credit-1',
    publicId: '0002-00000210',
    origin: 'RECEIPT',
    description: 'Se cargo dos veces el mismo deposito',
    state: null,
    dateIssued: '2026-08-20T11:00:00.000',
    dateVoided: '2026-08-20T11:00:00.000',
    amount: 400,
    signedAmount: 400,
    runningBalance: 1210,
  },
  { ...STATEMENT[0], dateVoided: '2026-08-20T11:00:00.000', state: 'ANULADO' },
  STATEMENT[1],
];

const DEBT: CheckingAccountDebtRowDto = {
  uuid: 'debt-1',
  accountUuid: ACCOUNT_UUID,
  publicId: '0001-00000042',
  origin: 'ORDER',
  state: 'VENCIDA',
  amount: 1210,
  pendingAmount: 300,
  dateIssued: '2026-08-01T10:15:00.000',
  dateDue: '2026-08-31',
  dateDueOriginal: '2026-08-31',
  dateVoided: null,
  description: 'Venta 0001-00000042',
  order: null,
};

/** Un anticipo: entro sin deuda que lo absorba, asi que quedo entero en la bandeja. */
const UNALLOCATED: CheckingAccountCreditRowDto = {
  uuid: 'credit-1',
  accountUuid: ACCOUNT_UUID,
  partyRole: null,
  publicId: null,
  origin: 'RECEIPT',
  state: 'SIN_IMPUTAR',
  amount: 700,
  unallocatedAmount: 700,
  autoAllocate: true,
  dateIssued: '2026-09-01T10:00:00.000',
  dateVoided: null,
  voidReason: null,
  description: 'Anticipo de Distribuidora Sur',
  branch: null,
  cashRegister: null,
};

describe('CheckingAccountDetailPage', () => {
  let fixture: ComponentFixture<CheckingAccountDetailPage>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * Las filas con datos. La fila de «sin resultados» de Material tambien lleva `mat-mdc-row`, asi que
   * contarla haria pasar por vacia una tabla vacia y por llena una tabla sin datos.
   */
  const rows = (): HTMLElement[] =>
    [...host().querySelectorAll<HTMLElement>('tr.mat-mdc-row')].filter(
      (row) => !row.querySelector('.detail__empty'),
    );

  /**
   * La ficha pide tres cosas en el mismo `ngOnInit`: la cuenta, su política y el historial de
   * morosidad. Las tres son del encabezado —el saldo, qué le rige y en qué estado de gestión está—,
   * así que se contestan juntas: dejar una colgando haría fallar el `http.verify()` de cada caso.
   */
  const answerAccount = (
    account: CheckingAccountRowDto | null,
    policy: object = POLICY,
    history: object[] = [],
  ): void => {
    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.BY_UUID}/${ACCOUNT_UUID}`),
    );
    request.flush(account);

    // Se piden con la ficha, pero no cada vez que se la recarga: una operación que mueve el saldo
    // vuelve a pedir la cuenta y nada más. Por eso se contestan si están, en vez de exigirlas — y
    // por método, porque guardar el override pega contra la misma URL que leerlo.
    const policyUrl = apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}/policy`);
    http
      .match((pending) => pending.method === 'GET' && pending.url === policyUrl)
      .forEach((pending) => pending.flush(policy));
    http
      .match(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}/delinquency`))
      .forEach((pending) => pending.flush(history));
    fixture.detectChanges();
  };

  const answerStatement = (entries: readonly StatementEntryRowDto[]): void => {
    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}/statement`),
    );
    request.flush({ content: entries, totalCount: entries.length });
    fixture.detectChanges();
  };

  const POLICY = {
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
      dueDaysSource: 'COMPANY',
      debtLimit: 100000,
      debtLimitSource: 'COMPANY',
      allocationMode: 'AUTOMATIC',
      allocationModeSource: 'DEFAULT',
    },
    reprocess: null,
  };

  const create = (granted: readonly string[] = []): void => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ uuid: ACCOUNT_UUID }) } },
        },
        // Sin permisos por default: lo que la pantalla ofrece de mas es lo que hay que probar.
        {
          provide: AuthService,
          useValue: {
            hasPermission: (permission: string) => granted.includes(permission),
            selectedBranchUuid: () => 'branch-uuid',
          },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CheckingAccountDetailPage);
    fixture.detectChanges();
  };

  beforeEach(() => {
    create();
  });

  afterEach(() => {
    http.verify();
  });

  /**
   * El criterio de aceptacion del extracto: las partidas salen en orden y el acumulado de la ultima
   * fila coincide con el saldo del encabezado. La pantalla no acumula nada — el backend calcula la
   * ventana sobre el extracto entero, no sobre la pagina.
   */
  it('cierra el acumulado del extracto en el saldo del encabezado', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    const statementRows = rows();
    expect(statementRows).toHaveLength(2);

    // La primera y no la última: el extracto sale del movimiento más nuevo al más viejo, así que la
    // fila de arriba es la que tiene el acumulado completo.
    const newestBalance = statementRows[0].querySelectorAll('td')[4].textContent ?? '';
    const headerBalance = host().querySelectorAll('.detail__figure-value')[0].textContent ?? '';

    expect(newestBalance.replace(/\s+/g, '')).toBe(headerBalance.replace(/\s+/g, ''));
  });

  /**
   * El extracto se abre para ver lo último que pasó, así que la página 1 tiene que traer eso y no el
   * alta de la cuenta.
   */
  it('lista el extracto del movimiento mas nuevo al mas viejo', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    const dateOf = (index: number): string =>
      rows()[index].querySelectorAll('td')[0].textContent ?? '';

    expect(dateOf(0)).toContain('15');
    expect(dateOf(1)).toContain('1');
    expect(new Date(STATEMENT[0].dateIssued).getTime()).toBeGreaterThan(
      new Date(STATEMENT[1].dateIssued).getTime(),
    );
  });

  /** El credito resta y la deuda suma, en las dos mitades: es la convencion unica de signos. */
  it('muestra el movimiento de cada partida con su signo', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    const movementOf = (index: number): string =>
      rows()[index].querySelectorAll('td')[3].textContent ?? '';

    expect(movementOf(0)).toContain('400');
    expect(movementOf(0)).toContain('-');
    expect(movementOf(1)).toContain('1.210');
  });

  /**
   * El encabezado son cuatro datos y no uno: el saldo, el vencido, y los dos terminos de los que
   * sale el saldo. La resta sola se lee como que no se debe nada.
   */
  it('informa saldo y vencido por separado', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    const figures = [...host().querySelectorAll('.detail__figure-value')].map(
      (node) => node.textContent?.replace(/\s+/g, '') ?? '',
    );

    expect(figures).toHaveLength(4);
    expect(figures[0]).toContain('810');
    expect(figures[1]).toContain('300');
  });

  /**
   * Una cuenta sin movimientos no es una tabla en blanco: es una cuenta a la que todavia no se le
   * fio nada, y la pantalla lo dice.
   */
  it('explica el vacio en vez de mostrar una tabla en blanco', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    expect(rows()).toHaveLength(0);
    const empty = host().querySelector('.detail__empty')?.textContent ?? '';
    expect(empty).toContain('checkingAccounts.detail.emptyStatement');
    expect(empty).toContain('checkingAccounts.detail.emptyStatementHint');
  });

  /**
   * El estado de la deuda llega calculado del backend y la pantalla lo pinta. Derivarlo aca dejaria
   * que un reloj corrido en la maquina del operador mostrara un estado distinto del que el sistema
   * usa para decidir.
   */
  it('pinta el estado que devuelve el back, sin recalcularlo', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`),
    );
    // Sin `states`: el backend devuelve las abiertas, que es lo que esta pestaña muestra.
    expect(request.request.body.states).toBeUndefined();
    request.flush({ content: [DEBT], totalCount: 1 });
    fixture.detectChanges();

    expect(
      host().querySelector('app-debt-state-chip .chip')?.getAttribute('data-state'),
    ).toBe('VENCIDA');
  });

  /**
   * La bandeja de «sin imputar» es la lista de tareas del administrativo. Sale del paginado de
   * cobros con dos pseudo-filtros que traduce el backend: ninguno de los dos es una columna de
   * `checking_account_credits`.
   */
  it('carga la bandeja de sin imputar acotada a esta cuenta', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE));
    const filters = (request.request.body.filtros ?? []).flat();
    expect(filters).toContainEqual(
      expect.objectContaining({ columna: 'accountUuid', valor: ACCOUNT_UUID }),
    );
    // La bandeja son dos estados y no un filtro aparte: `SIN_IMPUTAR` + `PARCIAL` es exactamente
    // «lo que todavía tiene plata para aplicar», y así la pestaña usa el mismo eje que las casillas.
    expect(filters).toContainEqual(
      expect.objectContaining({ columna: 'state', valor: 'SIN_IMPUTAR,PARCIAL' }),
    );

    request.flush({ content: [UNALLOCATED], totalCount: 1 });
    fixture.detectChanges();

    expect(host().textContent).toContain('Anticipo de Distribuidora Sur');
  });

  /** Las casillas se pintan con la bandeja tildada, sin que nadie la haya elegido. */
  const openCreditsTab = (): void => {
    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE))
      .flush({ content: [], totalCount: 0 });
    fixture.detectChanges();
  };

  const creditStateFilter = (): string | undefined => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE));
    const filters: { columna: string; valor: string }[] = (
      request.request.body.filtros ?? []
    ).flat();
    request.flush({ content: [], totalCount: 0 });
    return filters.find((filter) => filter.columna === 'state')?.valor;
  };

  /**
   * La pestaña dejo de ser solo la bandeja: el mismo listado contesta ahora en que termino la plata
   * de un cobro, que es una pregunta que desde aca no se podia hacer.
   *
   * Los estados viajan **en un solo filtro separados por coma**, no uno por casilla: el backend los
   * resuelve con un `IN` sobre el `CASE` que deriva el estado.
   */
  it('suma el estado tildado a los de la bandeja', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);
    openCreditsTab();

    fixture.componentInstance['onToggleCreditState']('ANULADO', true);
    fixture.detectChanges();

    expect(creditStateFilter()).toBe('SIN_IMPUTAR,PARCIAL,ANULADO');
  });

  it('al destildar uno de la bandeja deja de pedirlo', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);
    openCreditsTab();

    fixture.componentInstance['onToggleCreditState']('PARCIAL', false);
    fixture.detectChanges();

    expect(creditStateFilter()).toBe('SIN_IMPUTAR');
  });

  /**
   * Cambiar las casillas vuelve a la primera pagina: la 3 de la bandeja no es la 3 de los anulados, y
   * quedarse ahi deja la tabla vacia sobre un listado que si tiene filas.
   */
  it('al cambiar el filtro vuelve a la primera pagina', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);
    openCreditsTab();

    fixture.componentInstance['onToggleCreditState']('ANULADO', true);
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE));
    expect(request.request.body.page).toBe(1);
    request.flush({ content: [], totalCount: 0 });
  });

  /** El orden lo pone el backend, asi que la pantalla no manda ninguno que lo pueda contradecir. */
  it('no manda orden en el listado de cobros', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE));
    expect(request.request.body.ordenes ?? []).toEqual([]);
    request.flush({ content: [], totalCount: 0 });
  });

  /**
   * La fila que faltaba. Se ve entrar la deuda y se ve entrar el cobro; lo que no se veia era el acto
   * que los une, que es la pregunta mas comun sobre una cuenta corriente.
   */
  it('muestra la imputacion, con su modo y la deuda a la que fue', () => {
    answerAccount(ACCOUNT);
    answerStatement(ALLOCATED_STATEMENT);

    expect(host().textContent).toContain('checkingAccounts.detail.allocationBadge');
    // El modo y no la causa: la causa de una imputacion es siempre MANUAL y no informa nada.
    expect(host().textContent).toContain('checkingAccounts.allocationModes.AUTOMATIC');
    // Imputar no mueve el saldo: la columna de movimiento queda vacia, como en la desimputacion.
    expect(rows()[0].querySelectorAll('td')[3].textContent?.trim()).toBe('');
  });

  /**
   * Anular deja de reescribir el pasado: el cobro conserva su importe en su fecha y la anulacion es
   * una fila propia con el signo contrario. Antes la partida quedaba en cero en su fecha original, y
   * el saldo acumulado de los meses del medio cambiaba solo.
   */
  it('muestra la anulacion como una fila propia, sin vaciar la del cobro', () => {
    answerAccount(ACCOUNT);
    answerStatement(VOIDED_STATEMENT);

    const movementOf = (index: number): string =>
      rows()[index].querySelectorAll('td')[3].textContent ?? '';

    // El cobro sigue restando lo que restaba (tercera fila: debajo de la desimputación y la
    // anulación, que son posteriores).
    expect(movementOf(2)).toContain('400');
    expect(movementOf(2)).toContain('-');
    // Y la anulacion lo devuelve, en su propia fila.
    expect(host().textContent).toContain('checkingAccounts.detail.voidBadge');
    expect(movementOf(1)).toContain('400');
    expect(movementOf(1)).not.toContain('-');
  });

  /**
   * Cada desimputacion que produjo la anulacion entra con su causa. Sin esto, las deudas volvian a
   * estar enteras sin que ninguna fila del extracto dijera por que.
   */
  it('lista cada desimputacion con su causa y sin moverle el saldo', () => {
    answerAccount(ACCOUNT);
    answerStatement(VOIDED_STATEMENT);

    expect(host().textContent).toContain('checkingAccounts.detail.reversalBadge');
    expect(host().textContent).toContain('checkingAccounts.causes.CREDIT_VOID');
    // Desimputar no mueve el saldo: la columna de movimiento queda vacia, como en la prorroga.
    expect(rows()[0].querySelectorAll('td')[3].textContent?.trim()).toBe('');
  });

  /**
   * La bandeja vacia es el caso NORMAL —con la imputacion automatica casi todo entra ya aplicado—,
   * asi que tiene que decirlo en vez de mostrar un blanco que se lea como si algo estuviera roto.
   */
  it('explica por que la bandeja esta vacia', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE))
      .flush({ content: [], totalCount: 0 });
    fixture.detectChanges();

    const empty = host().querySelector('.detail__empty')?.textContent ?? '';
    expect(empty).toContain('checkingAccounts.detail.emptyUnallocated');
    expect(empty).toContain('checkingAccounts.detail.emptyUnallocatedHint');
  });

  /** Cada pestaña pide sus datos una sola vez: volver a ella no dispara otra consulta. */
  it('no vuelve a pedir la bandeja al volver a la pestaña', () => {
    answerAccount(ACCOUNT);
    answerStatement([]);

    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE))
      .flush({ content: [UNALLOCATED], totalCount: 1 });
    fixture.detectChanges();

    fixture.componentInstance['onTabChange'](0);
    fixture.componentInstance['onTabChange'](2);
    fixture.detectChanges();

    http.expectNone(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE));
  });

  /** Ni el extracto ni las deudas ofrecen ordenar: sus endpoints aceptan sólo página. */
  it('no ofrece encabezados ordenables que el backend ignoraría', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    expect(host().querySelectorAll('th.mat-sort-header')).toHaveLength(0);
  });


  /* ─────────────────────  Ajuste manual y prorroga (VTY-425)  ───────────────────── */

  /** Vuelve a armar la pantalla con permisos, ya con la cuenta y el extracto contestados. */
  const recreateWith = (granted: readonly string[], statement = STATEMENT): void => {
    TestBed.resetTestingModule();
    create(granted);
    answerAccount(ACCOUNT);
    answerStatement(statement);
  };

  /** Abre las deudas y contesta su paginado. */
  const openDebts = (): void => {
    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`))
      .flush({ content: [DEBT], totalCount: 1 });
    fixture.detectChanges();
  };

  const stubDialog = (result: unknown): Mock => {
    const open = vi.fn().mockReturnValue({ afterClosed: () => of(result) });
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(open as never);
    return open;
  };

  /**
   * Ofrecer un boton que va a contestar 403 es peor que no ofrecerlo: quien no puede ajustar tampoco
   * ve la accion, ni arriba ni en la fila de la deuda.
   */
  it('esconde ajustar y prorrogar a quien no tiene el permiso', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);
    openDebts();

    expect(host().textContent).not.toContain('checkingAccounts.actions.adjust');
    expect(host().querySelector('[aria-label="checkingAccounts.actions.extend"]')).toBeNull();
  });

  it('ofrece ajustar y prorrogar a quien si lo tiene', () => {
    recreateWith([Permissions.checkingAccountAdjust]);
    openDebts();

    expect(host().textContent).toContain('checkingAccounts.actions.adjust');
    expect(host().querySelector('[aria-label="checkingAccounts.actions.extend"]')).not.toBeNull();
  });

  /**
   * «El alta propone el vencimiento con la politica y deja editarlo.»
   *
   * La politica ya viene leida con la ficha, asi que el dialogo se abre con el plazo que rige de
   * verdad y sin una segunda vuelta: una propuesta armada con un plazo inventado no significa nada.
   */
  it('abre el dialogo de ajuste con el plazo que le rige al titular', () => {
    recreateWith([Permissions.checkingAccountAdjust]);
    const open = stubDialog(undefined);

    fixture.componentInstance['onAdjust']();
    fixture.detectChanges();

    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][1].data.dueDays).toBe(30);
  });

  /** El ajuste en contra viaja con su vencimiento; el sentido lo dice `direction`, no el signo. */
  it('manda el ajuste con su sentido, su motivo y el vencimiento elegido', () => {
    recreateWith([Permissions.checkingAccountAdjust]);
    stubDialog({
      direction: 'DEBIT',
      amount: 500,
      dateDue: '2026-10-01',
      reason: 'Error de carga de la migracion',
    });

    fixture.componentInstance['onAdjust']();
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ADJUSTMENT));
    expect(request.request.body).toEqual({
      accountUuid: ACCOUNT_UUID,
      direction: 'DEBIT',
      amount: 500,
      dateDue: '2026-10-01',
      reason: 'Error de carga de la migracion',
    });
    request.flush({ entryType: 'DEBT', balance: 1310 });

    // Ajustar mueve el saldo del encabezado y agrega una fila al extracto: se recargan los dos.
    answerAccount({ ...ACCOUNT, balance: 1310 });
    answerStatement(STATEMENT);
  });

  /** Un credito no vence: en un ajuste a favor la fecha ni se manda. */
  it('no manda vencimiento en un ajuste a favor', () => {
    recreateWith([Permissions.checkingAccountAdjust]);
    stubDialog({ direction: 'CREDIT', amount: 200, dateDue: null, reason: 'Condonacion' });

    fixture.componentInstance['onAdjust']();
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ADJUSTMENT));
    expect(request.request.body.dateDue).toBeUndefined();
    request.flush({ entryType: 'CREDIT', balance: 610 });

    answerAccount({ ...ACCOUNT, balance: 610 });
    answerStatement(STATEMENT);
  });

  /** La prorroga cuelga de la deuda, no de la cuenta. */
  it('prorroga la deuda contra su propio endpoint', () => {
    recreateWith([Permissions.checkingAccountAdjust]);
    openDebts();
    stubDialog({ dateDue: '2026-09-30', reason: 'El cliente pidio diez dias mas' });

    fixture.componentInstance['onExtendDebt'](DEBT);
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBT}/${DEBT.uuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.EXTEND_SUFFIX,
      ),
    );
    expect(request.request.body).toEqual({
      dateDue: '2026-09-30',
      reason: 'El cliente pidio diez dias mas',
    });
    request.flush({ ...DEBT, dateDue: '2026-09-30' });

    // El vencido del encabezado se deriva de los vencimientos: correr uno lo mueve, asi que la
    // pantalla vuelve a pedir todo lo que muestra.
    answerAccount({ ...ACCOUNT, overdueAmount: 0 });
    answerStatement(STATEMENT);
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`))
      .flush({ content: [{ ...DEBT, dateDue: '2026-09-30' }], totalCount: 1 });
    fixture.detectChanges();
  });

  /**
   * La prorroga se ve en el extracto como un evento propio: con su etiqueta, las dos fechas y quien
   * la autorizo. Y sin importe — no movio el saldo, y un «$ 0,00» ahi se leeria como un movimiento
   * de cero pesos.
   */
  it('muestra la prorroga en el extracto con sus dos fechas y sin importe', () => {
    const withExtension: readonly StatementEntryRowDto[] = [
      ...STATEMENT,
      {
        entryType: 'EXTENSION',
        uuid: 'extension-1',
        publicId: '0001-00000042',
        origin: null,
        description: 'El cliente pidio diez dias mas',
        state: null,
        dateIssued: '2026-08-20T11:00:00.000',
        dateVoided: null,
        amount: null,
        signedAmount: 0,
        runningBalance: 810,
        dateDue: '2026-09-30',
        previousDateDue: '2026-08-31',
        userName: 'Lorenzo',
      },
    ];

    recreateWith([], withExtension);

    const extensionRow = rows()[2];
    expect(extensionRow.textContent).toContain('checkingAccounts.detail.extensionBadge');
    expect(extensionRow.textContent).toContain('checkingAccounts.detail.extensionRange');
    expect(extensionRow.textContent).toContain('checkingAccounts.detail.byUser');
    // La columna de movimiento queda vacia; la de saldo acumulado sigue diciendo lo que vale.
    expect(extensionRow.querySelectorAll('td')[3].textContent?.trim()).toBe('');
    expect(extensionRow.querySelectorAll('td')[4].textContent).toContain('810');
  });

  /** Un ajuste no se lee como una venta: la fila lo dice con su etiqueta. */
  it('identifica el ajuste en el extracto', () => {
    const withAdjustment: readonly StatementEntryRowDto[] = [
      {
        entryType: 'DEBT',
        uuid: 'debt-adj',
        publicId: null,
        origin: 'ADJUSTMENT',
        description: 'Error de carga de la migracion',
        state: 'PENDIENTE',
        dateIssued: '2026-08-02T10:00:00.000',
        dateVoided: null,
        amount: 500,
        signedAmount: 500,
        runningBalance: 500,
        dateDue: '2026-09-01',
        previousDateDue: null,
        userName: 'Lorenzo',
      },
    ];

    recreateWith([], withAdjustment);

    expect(rows()[0].textContent).toContain('checkingAccounts.origins.ADJUSTMENT');
  });


  /* ─────────────────────────  Aviso de deuda (VTY-428)  ───────────────────────── */

  /**
   * El aviso comparte permiso con la morosidad: son las dos caras de la gestion de cobranza —
   * decidir que un cliente esta en gestion, y decirselo. Sin el permiso, la accion ni se ofrece.
   */
  it('no ofrece el aviso de deuda a quien no tiene el permiso', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    expect(host().textContent).not.toContain('checkingAccounts.actions.notice');
  });

  it('ofrece el aviso de deuda a quien si lo tiene', () => {
    recreateWith([Permissions.checkingAccountDelinquency]);

    expect(host().textContent).toContain('checkingAccounts.actions.notice');
  });

  /** El aviso viaja al endpoint de la cuenta con el texto que quedo, y el extracto se recarga. */
  it('manda el aviso y recarga el extracto', () => {
    recreateWith([Permissions.checkingAccountDelinquency]);
    stubDialog({
      recipient: 'cobranzas@cliente.test',
      subject: 'Detalle de deuda vencida',
      body: '<p>Detalle</p>',
    });

    fixture.componentInstance['onSendNotice']();
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.NOTICE_SUFFIX,
      ),
    );
    expect(request.request.body).toEqual({
      recipient: 'cobranzas@cliente.test',
      subject: 'Detalle de deuda vencida',
      body: '<p>Detalle</p>',
    });
    request.flush({ uuid: 'notice-1', accountUuid: ACCOUNT_UUID });

    // El aviso deja una fila en el extracto, pero no mueve ningun saldo: se recarga el extracto y
    // no la ficha.
    answerStatement(STATEMENT);
  });

  /**
   * La fila del aviso en el extracto dice a que direccion salio: «te avisamos» solo es un dato
   * cuando se puede contestar cuando y a donde.
   */
  it('muestra el aviso en el extracto con su direccion', () => {
    const withNotice: readonly StatementEntryRowDto[] = [
      ...STATEMENT,
      {
        entryType: 'NOTICE',
        uuid: 'notice-1',
        publicId: null,
        origin: null,
        description: 'Detalle de deuda vencida',
        state: 'cobranzas@cliente.test',
        dateIssued: '2026-08-20T11:00:00.000',
        dateVoided: null,
        amount: null,
        signedAmount: 0,
        runningBalance: 810,
        dateDue: null,
        previousDateDue: null,
        userName: 'Lorenzo',
      },
    ];

    recreateWith([], withNotice);

    const noticeRow = rows()[2];
    expect(noticeRow.textContent).toContain('checkingAccounts.detail.noticeBadge');
    expect(noticeRow.textContent).toContain('checkingAccounts.detail.noticeSentTo');
    // Mandar un mail no mueve el saldo: la columna de movimiento queda vacia.
    expect(noticeRow.querySelectorAll('td')[3].textContent?.trim()).toBe('');
  });

  /* ─────────────────────────  Recalculo de los caches (VTY-430)  ───────────────────────── */

  /**
   * El job de consistencia detecta y <b>no</b> corrige: una diferencia significa que hay un bug en
   * algun camino de escritura, y arreglarla sola lo esconderia. Corregir es una decision, y por eso
   * el boton pide el permiso de configuracion.
   */
  it('no ofrece recalcular a quien no puede configurar el modulo', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    expect(host().textContent).not.toContain('checkingAccounts.override.recalculate');
  });

  it('recalcula los caches de la cuenta y la recarga', () => {
    recreateWith([Permissions.checkingAccountConfig]);

    fixture.componentInstance['onRecalculate']();
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.RECALCULATE_SUFFIX,
      ),
    );
    request.flush({ accountsChecked: 1, discrepancies: 1, found: [] });

    // El saldo del encabezado y el extracto pudieron cambiar: se recargan los dos.
    answerAccount({ ...ACCOUNT, balance: 1210 });
    answerStatement(STATEMENT);
  });

  /* ───────────────────  Los cuatro numeros del encabezado (VTY-431)  ─────────────────── */

  /**
   * El saldo es `Σ pendiente − Σ sin imputar`, y esa resta esconde el estado: con imputacion manual
   * un neto a favor puede convivir con una factura impaga. Los cuatro numeros dicen de que esta
   * hecho el neto.
   */
  it('muestra los cuatro numeros del encabezado y no solo la resta', () => {
    answerAccount({ ...ACCOUNT, pendingAmount: 92565, unallocatedAmount: 145000 });
    answerStatement(STATEMENT);

    expect(host().querySelectorAll('.detail__figure')).toHaveLength(4);
    expect(host().textContent).toContain('checkingAccounts.detail.pendingTerm');
    expect(host().textContent).toContain('checkingAccounts.detail.unallocatedTerm');
  });

  /** El aviso sale solo cuando los dos terminos son distintos de cero: es el caso que enganya. */
  it('avisa cuando hay plata sin imputar conviviendo con deuda abierta', () => {
    answerAccount({ ...ACCOUNT, pendingAmount: 92565, unallocatedAmount: 145000 });
    answerStatement(STATEMENT);

    expect(host().querySelector('.detail__alert')).not.toBeNull();
    expect(host().textContent).toContain('checkingAccounts.detail.allocateNow');
  });

  it('no avisa cuando no hay nada sin imputar', () => {
    answerAccount({ ...ACCOUNT, pendingAmount: 92565, unallocatedAmount: 0 });
    answerStatement(STATEMENT);

    expect(host().querySelector('.detail__alert')).toBeNull();
  });

  /**
   * El cartel del saldo es lo unico que cambia entre las dos mitades: la aritmetica es una sola. Un
   * saldo negativo es siempre saldo a favor del titular, sin importar el rol.
   */
  it('rotula el saldo segun el rol, y a favor cuando es negativo', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);
    expect(host().textContent).toContain('checkingAccounts.detail.balanceTheyOwe');

    TestBed.resetTestingModule();
    create();
    answerAccount({ ...ACCOUNT, balance: -5000 });
    answerStatement(STATEMENT);
    expect(host().textContent).toContain('checkingAccounts.detail.balanceInFavour');
  });

  /* ─────────────────────  La politica del titular (VTY-423)  ───────────────────── */

  /**
   * La politica se pide en el mismo `ngOnInit` que la cuenta: forma parte del encabezado, que es lo
   * primero que se lee, y sin ella la ficha no puede contestar por que esta factura vence cuando
   * vence.
   */
  it('muestra que le rige al titular con la fuente de cada valor', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    expect(host().querySelector('.detail__policy')).not.toBeNull();
    expect(host().querySelectorAll('app-setting-source').length).toBe(3);
  });

  /** Editar el override es una decision de configuracion: sin el permiso no se ofrece. */
  it('no ofrece editar el override a quien no puede configurar', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    expect(host().textContent).not.toContain('checkingAccounts.detail.editOverride');
  });

  /**
   * «Heredar» es tambien la forma de sacar un override, y viaja como `INHERIT` y no como un nulo.
   * Al guardar se recarga el extracto: cada parametro que cambio deja ahi su fila.
   */
  it('guarda el override con lo que devuelve el dialogo y recarga el extracto', () => {
    recreateWith([Permissions.checkingAccountConfig]);
    stubDialog({
      dueDaysMode: 'VALUE',
      dueDays: 15,
      debtLimitMode: 'INHERIT',
      debtLimitAmount: null,
      allocationMode: 'MANUAL',
    });

    fixture.componentInstance['onEditPolicy']();
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}/policy`),
    );
    expect(request.request.body.dueDaysMode).toBe('VALUE');
    expect(request.request.body.debtLimitMode).toBe('INHERIT');
    expect(request.request.body.allocationMode).toBe('MANUAL');
    request.flush(POLICY);

    answerStatement(STATEMENT);
  });

  /**
   * En una compra no se valida ningun limite —cuanto nos fia un proveedor lo decide el proveedor—, y
   * mostrar un tope que nadie mira es una invitacion a que alguien lo implemente.
   */
  it('en la ficha de un proveedor no muestra el limite', () => {
    answerAccount({
      ...ACCOUNT,
      partyRole: { ...ACCOUNT.partyRole!, role: 'SUPPLIER' as const },
    });
    answerStatement(STATEMENT);

    const page = fixture.componentInstance as unknown as { showsLimit: () => boolean };
    expect(page.showsLimit()).toBe(false);
    expect(host().querySelectorAll('app-setting-source').length).toBe(2);
  });

  /* ─────────────────────  El kill switch de la cuenta (VTY-431)  ───────────────────── */

  /**
   * Apagar la cuenta es el unico freno que el modulo tiene sobre un titular puntual: el nivel de
   * morosidad no bloquea nada en ninguno de sus cuatro valores.
   */
  it('apaga la cuenta mandando el uuid y la version', () => {
    recreateWith([Permissions.checkingAccountConfig]);

    fixture.componentInstance['onToggleEnabled']();
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.SAVE));
    expect(request.request.body).toEqual({
      uuid: ACCOUNT_UUID,
      enabled: false,
      version: ACCOUNT.version,
    });
    request.flush({ ...ACCOUNT, enabled: false, version: ACCOUNT.version + 1 });
    fixture.detectChanges();

    expect(host().textContent).toContain('checkingAccounts.list.disabled');
  });

  /* ─────────────────────  Morosidad: el historial va en el dialogo  ───────────────────── */

  /**
   * La pregunta real no es «que nivel tiene» sino «desde cuando esta en estudio juridico y quien lo
   * decidio»: el historial viaja al dialogo que fija el nivel, y no a otra pantalla.
   */
  it('le pasa el historial al dialogo que fija el nivel', () => {
    TestBed.resetTestingModule();
    create([Permissions.checkingAccountDelinquency]);
    answerAccount(ACCOUNT, POLICY, [
      {
        uuid: 'event-2',
        accountUuid: ACCOUNT_UUID,
        level: 'MOROSO_GRAVE',
        previousLevel: 'EN_MORA',
        reason: 'Expediente al estudio',
        dateDecided: '2026-09-01T10:00:00.000',
      },
    ]);
    answerStatement(STATEMENT);

    const open = stubDialog(undefined);
    fixture.componentInstance['onSetDelinquency']();

    const data = open.mock.calls[0][1].data as { history: readonly { reason: string }[] };
    expect(data.history).toHaveLength(1);
    expect(data.history[0].reason).toBe('Expediente al estudio');
  });

  /* ─────────────────  Los filtros del extracto y de las deudas  ───────────────── */

  /**
   * La partida anulada se lista por default y suma cero: esconderla dejaría un salto de saldo sin
   * explicar. Poder sacarlas es para leer sólo lo que pesa.
   */
  it('el extracto pide las anuladas por default, y las saca cuando se lo piden', () => {
    answerAccount(ACCOUNT);
    const first = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}/statement`),
    );
    expect(first.request.body.includeVoided).toBe(true);
    first.flush({ content: STATEMENT, totalCount: STATEMENT.length });
    fixture.detectChanges();

    fixture.componentInstance['onToggleVoided'](false);
    fixture.detectChanges();

    const second = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${ACCOUNT_UUID}/statement`),
    );
    expect(second.request.body.includeVoided).toBe(false);
    second.flush({ content: STATEMENT, totalCount: STATEMENT.length });
    fixture.detectChanges();
  });

  /**
   * Sin tocar los chips no viaja `states`, y el backend devuelve las abiertas: pagada y anulada ya
   * no son deuda, y arrancar mostrandolas esconderia lo unico que hay que mirar.
   */
  it('las deudas arrancan sin pedir estados, que es pedir las abiertas', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`),
    );
    expect(request.request.body.states).toBeUndefined();
    request.flush({ content: [DEBT], totalCount: 1 });
    fixture.detectChanges();

    // Las tres abiertas se ven tildadas aunque no viajen: es lo que el backend va a devolver.
    const page = fixture.componentInstance as unknown as {
      isDebtStateOn: (state: string) => boolean;
    };
    expect(page.isDebtStateOn('VENCIDA')).toBe(true);
    expect(page.isDebtStateOn('PAGADA')).toBe(false);
  });

  /** Tildar un estado lo manda explicito: es la unica forma de ver lo pagado o lo anulado. */
  it('al tildar un estado lo pide por su nombre', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`))
      .flush({ content: [DEBT], totalCount: 1 });
    fixture.detectChanges();

    fixture.componentInstance['onToggleDebtState']('PAGADA', true);
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`),
    );
    expect(request.request.body.states).toEqual(['PAGADA']);
    request.flush({ content: [], totalCount: 0 });
    fixture.detectChanges();
  });

  /**
   * La deuda prorrogada muestra el vencimiento original al lado del nuevo: sin eso la mora se lee
   * como si siempre hubiera vencido mas tarde.
   */
  it('la deuda prorrogada muestra su vencimiento original', () => {
    answerAccount(ACCOUNT);
    answerStatement(STATEMENT);

    fixture.componentInstance['onTabChange'](1);
    fixture.detectChanges();
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.DEBTS}/${ACCOUNT_UUID}/debts`))
      .flush({
        content: [{ ...DEBT, dateDue: '2026-09-30', dateDueOriginal: '2026-08-31' }],
        totalCount: 1,
      });
    fixture.detectChanges();

    expect(host().textContent).toContain('checkingAccounts.debts.extendedFrom');
  });
});
