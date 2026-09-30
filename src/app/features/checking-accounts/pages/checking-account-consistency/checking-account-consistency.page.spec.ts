import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { PaginateQuery } from '../../../../core/paginate';
import { ConsistencyDiscrepancyDto } from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import { CheckingAccountConsistencyPage } from './checking-account-consistency.page';

/** Una diferencia de saldo abierta y una de morosidad ya revisada. */
const BALANCE: ConsistencyDiscrepancyDto = {
  uuid: 'disc-1',
  accountUuid: 'account-1',
  partyRole: { uuid: 'role-1', name: 'Distribuidora Sur' },
  invariantCode: 'BALANCE',
  cachedValue: '500',
  derivedValue: '800',
  difference: -300,
  dateDetected: '2026-09-05T03:15:00.000',
  resolvedAt: null,
};

const DELINQUENCY: ConsistencyDiscrepancyDto = {
  uuid: 'disc-2',
  accountUuid: 'account-2',
  partyRole: { uuid: 'role-2', name: 'Juan Pérez' },
  invariantCode: 'DELINQUENCY',
  cachedValue: 'EN_MORA',
  derivedValue: 'MOROSO',
  difference: null,
  dateDetected: '2026-08-28T03:15:00.000',
  resolvedAt: '2026-08-29T10:00:00.000',
};

/**
 * Las diferencias entre los caches y las partidas.
 *
 * Lo que esta pantalla tiene que sostener es una sola idea: **verificar no corrige**. Una diferencia
 * significa que hay un bug en algún camino de escritura, y arreglarla en silencio lo esconde.
 */
describe('CheckingAccountConsistencyPage', () => {
  let fixture: ComponentFixture<CheckingAccountConsistencyPage>;
  let http: HttpTestingController;
  let confirm: ReturnType<typeof vi.fn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const rows = (): HTMLElement[] =>
    [...host().querySelectorAll<HTMLElement>('tr.mat-mdc-row')].filter(
      (row) => !row.querySelector('.consistency__empty'),
    );

  const create = (): void => {
    confirm = vi.fn().mockReturnValue(of(true));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
        { provide: ConfirmDialogService, useValue: { confirm } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CheckingAccountConsistencyPage);
    fixture.detectChanges();
  };

  const answerList = (items: readonly ConsistencyDiscrepancyDto[]): PaginateQuery => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.DISCREPANCY_PAGINATE));
    const body = request.request.body as PaginateQuery;
    request.flush({ content: items, totalCount: items.length });
    fixture.detectChanges();
    return body;
  };

  beforeEach(() => {
    create();
  });

  afterEach(() => {
    http.verify();
  });

  it('abre listando las diferencias registradas', () => {
    answerList([BALANCE, DELINQUENCY]);

    expect(rows()).toHaveLength(2);
  });

  /**
   * Lo detectado en la ultima corrida arriba: una diferencia de hace tres meses ya la miro alguien.
   *
   * **La columna va en snake_case**: el paginado del Core arma SQL nativo con `tabla.columna`, y la
   * fecha de deteccion es el `date_created` de la fila — el mapper la expone con otro nombre porque
   * para quien lee es cuando se detecto, no cuando se inserto.
   */
  it('abre ordenado por fecha de deteccion descendente', () => {
    const body = answerList([BALANCE, DELINQUENCY]);

    expect(body.ordenes).toEqual([{ tabla: 't', columna: 'date_created', direccion: 'DESC' }]);
  });

  /**
   * En el invariante de morosidad la diferencia va en guión y no en cero: entre dos niveles no hay
   * resta que hacer, y un cero ahí se leería como «coinciden».
   */
  it('no inventa una resta entre dos niveles de morosidad', () => {
    answerList([DELINQUENCY]);

    const cells = rows()[0].querySelectorAll('td');
    expect(cells[5].textContent?.trim()).toBe('—');
  });

  /** La fila revisada se queda en el listado, en gris y con su fecha: borrarla perdería el dato. */
  it('deja la fila revisada en la lista, con su fecha', () => {
    answerList([DELINQUENCY]);

    expect(rows()[0].classList.contains('consistency__row--reviewed')).toBe(true);
    expect(rows()[0].textContent).toContain('checkingAccounts.consistency.reviewedOn');
    // Y no ofrece recalcularla otra vez: ya la miró alguien.
    expect(rows()[0].querySelector('button')).toBeNull();
  });

  /**
   * La corrida verifica y **no escribe ningún cache**. Informa cuántas cuentas miró porque «no
   * encontré nada» y «no miré nada» se leen igual sin ese número.
   */
  it('corre la verificacion y muestra cuantas cuentas miro', () => {
    answerList([]);

    fixture.componentInstance['onRun']();
    fixture.detectChanges();

    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CONSISTENCY_RUN))
      .flush({
        accountsChecked: 214,
        discrepancies: 0,
        balanceDiscrepancies: 0,
        delinquencyDiscrepancies: 0,
        found: [],
      });
    fixture.detectChanges();

    // Y recarga la lista, que es lo que la corrida pudo haber cambiado.
    answerList([]);

    expect(host().textContent).toContain('214');
    expect(host().textContent).toContain('checkingAccounts.consistency.empty.title');
  });

  /**
   * Sin ninguna corrida en esta pantalla no se estampa una fecha: el backend no expone cuándo corrió
   * la última vez, e inventarla sobre una verificación es peor que no ponerla.
   */
  it('sin corrida no afirma cuando se verifico', () => {
    answerList([]);

    expect(host().querySelector('.consistency__figures')).toBeNull();
    expect(host().textContent).toContain('checkingAccounts.consistency.empty.never');
  });

  /**
   * Recalcular reescribe un cache, así que se confirma: es la única acción de la pantalla que
   * cambia un dato, y la que deja la diferencia dada por revisada.
   */
  it('recalcula la cuenta despues de confirmar, y recarga', () => {
    answerList([BALANCE]);

    fixture.componentInstance['onRecalculate'](BALANCE);
    fixture.detectChanges();

    expect(confirm).toHaveBeenCalledOnce();

    http
      .expectOne(
        apiUrl(
          `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${BALANCE.accountUuid}` +
            API_ENDPOINTS.CHECKING_ACCOUNTS.RECALCULATE_SUFFIX,
        ),
      )
      .flush({
        accountsChecked: 1,
        discrepancies: 1,
        balanceDiscrepancies: 1,
        delinquencyDiscrepancies: 0,
        found: [],
      });
    fixture.detectChanges();

    answerList([{ ...BALANCE, resolvedAt: '2026-09-08T12:00:00.000' }]);
  });

  /** Cancelar no escribe nada: recalcular es una decisión, y no confirmarla es no tomarla. */
  it('no recalcula si no se confirma', () => {
    answerList([BALANCE]);
    confirm.mockReturnValue(of(false));

    fixture.componentInstance['onRecalculate'](BALANCE);
    fixture.detectChanges();

    http.expectNone(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${BALANCE.accountUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.RECALCULATE_SUFFIX,
      ),
    );
  });
});
