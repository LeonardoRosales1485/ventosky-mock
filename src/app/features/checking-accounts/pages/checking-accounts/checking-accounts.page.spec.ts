import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { PaginateQuery } from '../../../../core/paginate';
import { CheckingAccountRowDto } from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import { CheckingAccountsPage } from './checking-accounts.page';

const CUSTOMER: CheckingAccountRowDto = {
  uuid: 'account-customer',
  partyRoleUuid: 'role-customer',
  partyRole: {
    uuid: 'role-customer',
    name: 'Distribuidora Sur',
    docType: 'CUIT',
    docNumber: '30111222333',
    role: 'CUSTOMER',
  },
  partyUuid: 'party-1',
  balance: 84000,
  oldestOverdueDays: null,
  delinquencyLevel: 'AL_DIA',
  overdueAmount: 12000,
  enabled: true,
  version: 1,
};

const SUPPLIER: CheckingAccountRowDto = {
  ...CUSTOMER,
  uuid: 'account-supplier',
  partyRoleUuid: 'role-supplier',
  partyRole: {
    uuid: 'role-supplier',
    name: 'Papelera Norte',
    docType: 'CUIT',
    docNumber: '30999888777',
    role: 'SUPPLIER',
  },
  partyUuid: 'party-2',
  oldestOverdueDays: null,
  delinquencyLevel: 'AL_DIA',
  overdueAmount: 0,
};

describe('CheckingAccountsPage', () => {
  let fixture: ComponentFixture<CheckingAccountsPage>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const rows = (): HTMLElement[] => [...host().querySelectorAll<HTMLElement>('tr.mat-mdc-row')];

  const headers = (): string[] =>
    [...host().querySelectorAll<HTMLElement>('th')].map((th) => th.textContent?.trim() ?? '');

  /** La única consulta al paginado que haya pendiente, ya respondida. */
  const answerPaginate = (accounts: readonly CheckingAccountRowDto[]): PaginateQuery => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.PAGINATE));
    const query = request.request.body as PaginateQuery;

    request.flush({ content: accounts, totalCount: accounts.length });
    fixture.detectChanges();

    return query;
  };

  const create = (): void => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CheckingAccountsPage);
    fixture.detectChanges();
  };

  beforeEach(() => {
    create();
  });

  afterEach(() => {
    http.verify();
  });

  /** El listado sale del backend: la pantalla no recalcula saldos ni vencidos. */
  it('abre pidiendo la primera página al paginado real', () => {
    const query = answerPaginate([CUSTOMER, SUPPLIER]);

    expect(query.page).toBe(1);
    expect(rows()).toHaveLength(2);
  });

  /**
   * Las seis columnas del listado, y **el disponible no es una de ellas**: sale de `/availability`,
   * que resuelve la decisión del portón para una operación y un importe concretos, y en el paginado
   * no viaja. Una columna con un cero o un guion es peor que una que no está, porque la primera
   * parece un dato.
   */
  it('lista las seis columnas y deja el disponible fuera', () => {
    answerPaginate([CUSTOMER]);

    const shown = headers().join(' ');
    expect(shown).toContain('checkingAccounts.columns.party');
    expect(shown).toContain('checkingAccounts.columns.document');
    expect(shown).toContain('checkingAccounts.columns.role');
    expect(shown).toContain('checkingAccounts.columns.balance');
    expect(shown).toContain('checkingAccounts.columns.overdueAmount');
    expect(shown).toContain('checkingAccounts.columns.delinquency');
    expect(shown).not.toContain('checkingAccounts.columns.available');
  });

  /** El nivel lo fija una persona y no bloquea nada; la fila lo informa con su chip. */
  it('muestra el nivel de morosidad que trae la fila', () => {
    answerPaginate([{ ...CUSTOMER, delinquencyLevel: 'MOROSO' }]);

    expect(rows()[0].textContent).toContain('checkingAccounts.delinquency.MOROSO');
  });

  /**
   * El criterio de aceptacion del signo: la aritmética es una sola en las dos mitades y lo único que
   * cambia es el cartel. Dos cuentas con el mismo saldo muestran el mismo número y textos distintos.
   */
  it('lee el mismo saldo con el cartel de cada rol', () => {
    answerPaginate([CUSTOMER, SUPPLIER]);

    const [customerRow, supplierRow] = rows();
    // La cuarta celda es el saldo: titular, documento, rol, saldo.
    const amountOf = (row: HTMLElement): string =>
      row.querySelectorAll('td')[3].textContent?.replace(/\s+/g, '') ?? '';

    expect(amountOf(customerRow)).toBe(amountOf(supplierRow));
    expect(customerRow.textContent).toContain('checkingAccounts.roles.CUSTOMER');
    expect(supplierRow.textContent).toContain('checkingAccounts.roles.SUPPLIER');
  });

  /** Un saldo negativo es saldo a favor del titular, y la fila lo dice con palabras. */
  it('anuncia el saldo a favor en vez de dejar que el menos lo insinúe', () => {
    answerPaginate([{ ...CUSTOMER, balance: -5000 }]);

    expect(rows()[0].textContent).toContain('checkingAccounts.list.creditBalance');
  });

  /**
   * Los dos filtros viajan por su nombre de negocio sobre `t`. Ni `role` ni `hasOverdue` son columnas
   * de `checking_accounts` —viven en `party_roles` y en los vencimientos del día—, y traducirlos es
   * trabajo del backend: la pantalla no sabe dónde están.
   */
  it('filtra por tipo de titular sin saber en qué tabla vive el rol', () => {
    answerPaginate([]);

    host().querySelector<HTMLButtonElement>('[data-testid="table-toolbar-filters"]')?.click();
    fixture.detectChanges();
    fixture.componentInstance['onRoleChange']('SUPPLIER');
    fixture.detectChanges();

    const query = answerPaginate([SUPPLIER]);
    const filtro = query.filtros?.flat().find((item) => item.columna === 'role');

    expect(filtro).toBeDefined();
    expect(filtro?.tabla).toBe('t');
    expect(filtro?.valor).toBe('SUPPLIER');
  });

  it('filtra por «con deuda vencida» como un booleano y no como un importe', () => {
    answerPaginate([]);

    fixture.componentInstance['onOnlyOverdueChange'](true);
    fixture.detectChanges();

    const query = answerPaginate([CUSTOMER]);
    const filtro = query.filtros?.flat().find((item) => item.columna === 'hasOverdue');

    expect(filtro).toBeDefined();
    // Viaja como texto: el paginado serializa todo a string y el backend lo lee con
    // `Boolean.parseBoolean`. Lo que importa es que sea un booleano y no un importe a comparar.
    expect(filtro?.valor).toBe('true');
  });

  /**
   * `overdueAmount` se muestra pero no se ordena: el backend lo calcula después de la consulta, así
   * que un orden por esa columna valdría sólo dentro de la página.
   */
  it('no ofrece ordenar por el vencido', () => {
    answerPaginate([CUSTOMER]);

    const sortable = [...host().querySelectorAll<HTMLElement>('th.mat-sort-header')].map(
      (th) => th.textContent?.trim() ?? '',
    );

    expect(sortable.some((label) => label.includes('columns.balance'))).toBe(true);
    expect(sortable.some((label) => label.includes('columns.overdueAmount'))).toBe(false);
  });
});
