import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { PaginateQuery } from '../../../../core/paginate';
import { CheckingAccountCreditRowDto } from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import { CollectionsPage } from './collections.page';

const COLLECTED: CheckingAccountCreditRowDto = {
  uuid: 'credit-1',
  accountUuid: 'account-1',
  partyRole: {
    uuid: 'role-1',
    name: 'Distribuidora Sur',
    docType: 'CUIT',
    docNumber: '30111222333',
    role: 'CUSTOMER',
  },
  publicId: 'REC-000148',
  origin: 'RECEIPT',
  state: 'IMPUTADO',
  amount: 1210,
  unallocatedAmount: 0,
  autoAllocate: true,
  dateIssued: '2026-09-01T10:00:00.000',
  dateVoided: null,
  voidReason: null,
  description: 'Cobro de Distribuidora Sur',
  branch: null,
  cashRegister: null,
};

const PENDING: CheckingAccountCreditRowDto = {
  ...COLLECTED,
  uuid: 'credit-2',
  publicId: 'REC-000149',
  state: 'SIN_IMPUTAR',
  amount: 700,
  unallocatedAmount: 700,
  description: 'Anticipo',
};

describe('CollectionsPage', () => {
  let fixture: ComponentFixture<CollectionsPage>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * Las filas con datos. La fila de «sin resultados» de Material tambien lleva `mat-mdc-row`, asi que
   * contarla haria pasar por llena una tabla vacia.
   */
  const rows = (): HTMLElement[] =>
    [...host().querySelectorAll<HTMLElement>('tr.mat-mdc-row')].filter(
      (row) => !row.querySelector('.collections__empty'),
    );

  const answer = (content: readonly CheckingAccountCreditRowDto[]): PaginateQuery => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT_PAGINATE));
    const body = request.request.body as PaginateQuery;
    request.flush({ content, totalCount: content.length });
    fixture.detectChanges();
    return body;
  };

  const create = (granted: readonly string[] = []): void => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([{ path: '**', children: [] }]),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
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
    fixture = TestBed.createComponent(CollectionsPage);
    fixture.detectChanges();
  };

  beforeEach(() => {
    create();
  });

  afterEach(() => {
    http.verify();
  });

  /** El listado sale del paginado real, no de un mock en memoria. */
  it('lista los cobros con su numero, su titular y su estado', () => {
    answer([COLLECTED, PENDING]);

    expect(rows()).toHaveLength(2);
    // El recibo lleva numero propio: es lo que alguien anota y despues busca.
    expect(host().textContent).toContain('REC-000148');
    expect(host().textContent).toContain('Distribuidora Sur');
    // El estado llega derivado del backend; la pantalla lo pinta y no lo recalcula.
    expect(host().querySelectorAll('.chip')[0].getAttribute('data-state')).toBe('IMPUTADO');
    expect(host().querySelectorAll('.chip')[1].getAttribute('data-state')).toBe('SIN_IMPUTAR');
  });

  /**
   * Se busca por titular o por numero de recibo: son las dos formas de encontrar un cobro.
   *
   * **El numero de recibo va con su nombre real de columna.** El paginado del Core arma SQL nativo
   * concatenando `tabla.columna`, asi que `t.publicId` es una columna que Postgres no tiene y el
   * buscador rompia. `partyName` si es pseudo-columna, y esa la traduce el backend.
   */
  it('busca por titular y por numero de recibo', () => {
    answer([COLLECTED, PENDING]);

    fixture.componentInstance['onSearch']('REC-000148');
    const body = answer([COLLECTED]);

    const columns = (body.filtros ?? []).flat().map((filter) => filter.columna);
    expect(columns).toContain('public_id');
    expect(columns).toContain('partyName');
  });

  /**
   * El listado abre con el ultimo cobro arriba: la pregunta que trae a esta pantalla es «que entro
   * recien», y un recibo viejo no se busca recorriendo la lista sino por su numero.
   */
  it('abre ordenado por fecha descendente', () => {
    const body = answer([COLLECTED, PENDING]);

    expect(body.ordenes).toEqual([{ tabla: 't', columna: 'date_issued', direccion: 'DESC' }]);
  });

  /**
   * `state` no es una columna de `checking_account_credits`: el backend la traduce. La pantalla la
   * pide por su nombre y no sabe —ni tiene por que— donde vive.
   */
  it('filtra por estado de imputacion pidiendo la pseudo-columna por su nombre', () => {
    answer([COLLECTED, PENDING]);

    fixture.componentInstance['onStateFilter']('SIN_IMPUTAR');
    const body = answer([PENDING]);

    const filters = (body.filtros ?? []).flat();
    expect(filters).toContainEqual(
      expect.objectContaining({ tabla: 't', columna: 'state', valor: 'SIN_IMPUTAR' }),
    );
    expect(rows()).toHaveLength(1);
  });

  /** Lo mismo con el titular: vive en `parties`, y la pantalla lo pide como `partyName`. */
  it('filtra por tipo de titular sin saber en que tabla vive', () => {
    answer([COLLECTED, PENDING]);

    fixture.componentInstance['onRoleFilter']('SUPPLIER');
    const body = answer([]);

    const filters = (body.filtros ?? []).flat();
    expect(filters).toContainEqual(
      expect.objectContaining({ tabla: 't', columna: 'role', valor: 'SUPPLIER' }),
    );
  });

  /**
   * Ordenar por estado no se ofrece: se resuelve como un `IN` de ids y no como una columna, asi que
   * el encabezado prometeria un orden que el backend ignora.
   */
  it('no ofrece ordenar por estado', () => {
    answer([COLLECTED]);

    const sortable = [...host().querySelectorAll('th.mat-sort-header')].map(
      (header) => header.textContent?.trim() ?? '',
    );
    expect(sortable.some((label) => label.includes('columns.state'))).toBe(false);
  });

  /** Una tabla vacia no es una tabla en blanco: dice que todavia no se cobro nada y por donde. */
  it('explica el vacio en vez de mostrar una tabla en blanco', () => {
    answer([]);

    expect(rows()).toHaveLength(0);
    const empty = host().querySelector('.collections__empty')?.textContent ?? '';
    expect(empty).toContain('checkingAccounts.collections.empty');
    expect(empty).toContain('checkingAccounts.collections.emptyHint');
  });

  /* ─────────────────────────  Anulacion de un cobro (VTY-426)  ───────────────────────── */

  /** Vuelve a armar la pantalla con permisos y contesta el paginado. */
  const recreateWith = (
    granted: readonly string[],
    content: readonly CheckingAccountCreditRowDto[],
  ): void => {
    TestBed.resetTestingModule();
    create(granted);
    answer(content);
  };

  const voidButton = (index = 0): HTMLButtonElement | null =>
    rows()[index].querySelector<HTMLButtonElement>('[aria-label="checkingAccounts.actions.void"]');

  const stubDialog = (result: unknown): Mock => {
    const open = vi.fn().mockReturnValue({ afterClosed: () => of(result) });
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(open as never);
    return open;
  };

  /**
   * Anular es la operacion de mas impacto del modulo y tiene permiso propio: quien cobra no
   * necesariamente puede deshacer un cobro, y sin el permiso la accion ni se ofrece.
   */
  it('no ofrece anular a quien no tiene el permiso', () => {
    answer([COLLECTED]);

    expect(voidButton()).toBeNull();
  });

  it('ofrece anular a quien si lo tiene', () => {
    recreateWith([Permissions.checkingAccountVoid], [COLLECTED]);

    expect(voidButton()).not.toBeNull();
  });

  /** Un cobro ya anulado no se anula de nuevo: el boton queda apagado y dice por que. */
  it('deshabilita anular en un cobro ya anulado', () => {
    recreateWith(
      [Permissions.checkingAccountVoid],
      [{ ...COLLECTED, dateVoided: '2026-09-02T10:00:00.000', state: 'ANULADO' }],
    );

    expect(voidButton()?.disabled).toBe(true);
  });

  /** Con el motivo confirmado, la anulacion viaja al endpoint del cobro y el listado se recarga. */
  it('manda la anulacion con su motivo y refresca el listado', () => {
    recreateWith([Permissions.checkingAccountVoid], [COLLECTED]);
    stubDialog({ reason: 'El cliente pago con un cheque sin fondos' });

    voidButton()?.click();
    fixture.detectChanges();

    const request = http.expectOne(
      apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${COLLECTED.uuid}/void`),
    );
    expect(request.request.body).toEqual({ reason: 'El cliente pago con un cheque sin fondos' });
    request.flush({ ...COLLECTED, dateVoided: '2026-09-05T10:00:00.000' });

    // Anular cambia el estado de la fila y el saldo del titular: el listado se vuelve a pedir.
    answer([{ ...COLLECTED, dateVoided: '2026-09-05T10:00:00.000', state: 'ANULADO' }]);
  });

  /** Cerrar el dialogo sin confirmar no anula nada. */
  it('cancelar el dialogo no anula', () => {
    recreateWith([Permissions.checkingAccountVoid], [COLLECTED]);
    stubDialog(undefined);

    voidButton()?.click();
    fixture.detectChanges();

    http.expectNone(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${COLLECTED.uuid}/void`));
  });
});
