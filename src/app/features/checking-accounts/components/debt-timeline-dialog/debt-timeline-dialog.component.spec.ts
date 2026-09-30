import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { Mock, afterEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  CheckingAccountAllocationRowDto,
  CheckingAccountCreditRowDto,
  CheckingAccountDebtRowDto,
  DebtExtensionRowDto,
} from '../../data-access/checking-account.model';
import { DebtTimelineDialogComponent, DebtTimelineDialogData } from './debt-timeline-dialog.component';

const DEBT: CheckingAccountDebtRowDto = {
  uuid: 'debt-1',
  accountUuid: 'account-1',
  publicId: '3',
  origin: 'ORDER',
  state: 'PARCIAL',
  amount: 90750,
  pendingAmount: 20750,
  dateIssued: '2026-09-07T10:15:00.000',
  dateDue: '2026-10-31',
  dateDueOriginal: '2026-10-07',
  dateVoided: null,
  description: 'Venta 3',
  order: { uuid: 'order-7', name: '3' },
};

const PRORROGA: DebtExtensionRowDto = {
  uuid: 'ext-1',
  accountUuid: 'account-1',
  debtUuid: 'debt-1',
  debtPublicId: '3',
  previousDue: '2026-10-07',
  newDue: '2026-10-31',
  reason: 'El cliente pidio 24 dias mas',
  dateDecided: '2026-09-08T09:00:00.000',
};

const IMPUTACION: CheckingAccountAllocationRowDto = {
  uuid: 'alloc-1',
  dateCreated: '2026-09-07T11:00:00.000',
  entryType: 'ALLOCATION',
  amount: 50000,
  signedAmount: 50000,
  cause: 'MANUAL',
  mode: 'MANUAL',
  reason: null,
  debtUuid: 'debt-1',
  debtPublicId: '3',
  creditUuid: 'credit-9',
  creditPublicId: 'REC-000009',
  reversesUuid: null,
  originUuid: null,
};

const CREDITO: CheckingAccountCreditRowDto = {
  uuid: 'credit-9',
  accountUuid: 'account-1',
  publicId: 'REC-000009',
  origin: 'RECEIPT',
  state: 'PARCIAL',
  amount: 50000,
  unallocatedAmount: 0,
  dateIssued: '2026-09-07T11:00:00.000',
  dateVoided: null,
  voidReason: null,
  description: 'Cobro de Lorenzo',
  partyRole: null,
  autoAllocate: true,
  branch: null,
  cashRegister: null,
};

const DATA: DebtTimelineDialogData = { debt: DEBT };

/**
 * La línea de tiempo de una deuda: el único lugar donde las imputaciones se ven de a una, y desde
 * donde se desimputa y se reimputa.
 */
describe('DebtTimelineDialogComponent', () => {
  let fixture: ComponentFixture<DebtTimelineDialogComponent>;
  let http: HttpTestingController;
  let close: Mock;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /**
   * El diálogo pide dos cosas cuando abre sobre una deuda: su línea de tiempo y sus prórrogas. La
   * segunda se contesta acá para que cada test siga hablando sólo de lo suyo — y para que el
   * `http.verify()` del `afterEach` no falle por un request que ningún test miró.
   */
  const create = (
    data: DebtTimelineDialogData = DATA,
    extensions: readonly DebtExtensionRowDto[] = [],
  ): void => {
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        // El panel de contexto enlaza a la venta o a la compra de la que salió la deuda.
        provideRouter([]),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DebtTimelineDialogComponent);
    fixture.detectChanges();

    if (data.debt) {
      http
        .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.DEBT_EXTENSION_PAGINATE))
        .flush({ content: extensions, totalCount: extensions.length });
      fixture.detectChanges();
    }
  };

  /**
   * La línea de tiempo, vacía. La primera de las dos consultas queda para cada test porque varios la
   * miran; los que hablan del panel de contexto la contestan con esto y no la vuelven a nombrar.
   */
  const answerEmptyTimeline = (): void => {
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE))
      .flush({ content: [], totalElements: 0 });
    fixture.detectChanges();
  };

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /* ─────────────────────────  El panel de contexto  ───────────────────────── */

  /**
   * De dónde sale la deuda, con un enlace de vuelta a la operación.
   *
   * **No hay pantalla de detalle de una orden**, así que el enlace abre el listado que corresponde ya
   * buscando ese comprobante: los dos listados buscan por `public_id`. Cliente ⇒ venta, proveedor ⇒
   * compra, y eso lo decide la cuenta porque la deuda no lo sabe: `origin: ORDER` no distingue.
   */
  it('lleva a la venta cuando el titular es un cliente', () => {
    create({ debt: DEBT, partyRole: 'CUSTOMER' });
    answerEmptyTimeline();

    const link = host().querySelector<HTMLAnchorElement>('.timeline__order');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toContain('/panel/sales');
    expect(link!.getAttribute('href')).toContain('q=3');
  });

  it('lleva a la compra cuando el titular es un proveedor', () => {
    create({ debt: DEBT, partyRole: 'SUPPLIER' });
    answerEmptyTimeline();

    const link = host().querySelector<HTMLAnchorElement>('.timeline__order');
    expect(link!.getAttribute('href')).toContain('/panel/purchases');
  });

  /** Un ajuste no sale de ninguna operación: no hay comprobante al que volver, y se dice. */
  it('no ofrece enlace cuando la deuda no salio de una operacion', () => {
    create({ debt: { ...DEBT, origin: 'ADJUSTMENT', order: null }, partyRole: 'CUSTOMER' });
    answerEmptyTimeline();

    expect(host().querySelector('.timeline__order')).toBeNull();
    expect(host().textContent).toContain('checkingAccounts.timeline.noOrder');
  });

  /** Cada prórroga dice de qué fecha a cuál y por qué, sin inferirlo de la fila anterior. */
  it('lista las prorrogas de la deuda', () => {
    create(DATA, [PRORROGA]);
    answerEmptyTimeline();

    const item = host().querySelector('.timeline__extension');
    expect(item).not.toBeNull();
    expect(item!.textContent).toContain('El cliente pidio 24 dias mas');
    expect(host().textContent).not.toContain('checkingAccounts.timeline.noExtensions');
  });

  it('pide las prorrogas de esa deuda y de ninguna otra', () => {
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DebtTimelineDialogComponent);
    fixture.detectChanges();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.DEBT_EXTENSION_PAGINATE));
    const filtros = (request.request.body.filtros ?? []).flat();
    // `debtUuid` no es una columna de la tabla: el backend lo traduce a un JOIN contra la deuda.
    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'debtUuid', valor: DEBT.uuid }),
    );
    request.flush({ content: [], totalCount: 0 });
    fixture.detectChanges();
    answerEmptyTimeline();
  });

  /** Una deuda sin prorrogar lo dice, en vez de dejar el bloque en blanco. */
  it('dice que nunca se prorrogo cuando no hay ninguna', () => {
    create();
    answerEmptyTimeline();

    expect(host().textContent).toContain('checkingAccounts.timeline.noExtensions');
  });

  /**
   * **El cuerpo del request, no sólo la respuesta.** El paginado del Core arma SQL nativo
   * concatenando `tabla.columna direccion`, así que el nombre de la columna es el de la tabla y el
   * campo de la dirección se llama `direccion`. Un orden mal armado sale como `ORDER BY t.x null`,
   * que Postgres rechaza: la lista queda vacía y el diálogo no muestra nada.
   *
   * Un test que sólo mockee la respuesta pasa igual con la consulta rota, que es exactamente lo que
   * dejó pasar este error.
   */
  it('pide las imputaciones de la deuda con un orden que el backend pueda ejecutar', () => {
    create();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE));
    const body = request.request.body as {
      filtros: { tabla: string; columna: string; operacion: string; valor: string }[][];
      ordenes: { tabla: string; columna: string; direccion?: string; orden?: string }[];
    };

    expect(body.filtros.at(-1)?.[0]).toMatchObject({
      tabla: 't',
      columna: 'debtUuid',
      operacion: '=',
      valor: DEBT.uuid,
    });

    const orden = body.ordenes[0];
    expect(orden.columna).toBe('date_created');
    expect(orden.direccion?.toUpperCase()).toBe('ASC');
    expect(orden.orden).toBeUndefined();

    request.flush({ content: [IMPUTACION], totalElements: 1 });
  });

  /** Lo que el usuario viene a ver: contra qué cobro se aplicó, y por cuánto. */
  it('muestra la imputacion con su cobro y su importe', () => {
    create();

    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE))
      .flush({ content: [IMPUTACION], totalElements: 1 });
    fixture.detectChanges();

    expect(host().textContent).toContain('REC-000009');
    expect(host().textContent).toContain('50.000');
  });

  /**
   * Desde el cobro, la misma cadena leída al revés: a qué deudas se aplicó esta plata.
   *
   * Es la pregunta que la bandeja de «Créditos sin imputar» no contestaba — mostraba cuánto quedaba
   * sin imputar y no dónde había ido lo demás.
   */
  it('desde el cobro pregunta por creditUuid y muestra la deuda de cada imputacion', () => {
    create({ credit: CREDITO });

    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE));
    const body = request.request.body as {
      filtros: { columna: string; valor: string }[][];
      ordenes: { columna: string; direccion?: string }[];
    };
    expect(body.filtros.at(-1)?.[0]).toMatchObject({ columna: 'creditUuid', valor: CREDITO.uuid });
    expect(body.ordenes[0].columna).toBe('date_created');

    request.flush({ content: [IMPUTACION], totalElements: 1 });
    fixture.detectChanges();

    // La fila dice la DEUDA, que es lo que desde el cobro no se sabía.
    expect(host().textContent).toContain(IMPUTACION.debtPublicId);
  });

  /**
   * Reimputar necesita la deuda de origen como fila y desde el cobro sólo se tiene su uuid; además,
   * mover una imputación es una decisión sobre la deuda. Deshacer sí se ofrece.
   */
  it('desde el cobro no ofrece reimputar', () => {
    create({ credit: CREDITO });

    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE))
      .flush({ content: [IMPUTACION], totalElements: 1 });
    fixture.detectChanges();

    expect(host().textContent).not.toContain('checkingAccounts.actions.reassign');
  });

  /**
   * Una imputación con saldo vigente se puede deshacer; una ya revertida, no. El vigente se calcula
   * sobre las filas en pantalla, porque las reversiones apuntan a lo que deshacen.
   */
  it('no ofrece deshacer una imputacion ya revertida', () => {
    create();

    const reversion: CheckingAccountAllocationRowDto = {
      ...IMPUTACION,
      uuid: 'alloc-2',
      dateCreated: '2026-09-07T12:00:00.000',
      entryType: 'REVERSAL',
      signedAmount: -50000,
      reversesUuid: IMPUTACION.uuid,
    };
    http
      .expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION_PAGINATE))
      .flush({ content: [IMPUTACION, reversion], totalElements: 2 });
    fixture.detectChanges();

    const acciones = host().querySelectorAll('button[data-testid="reverse-allocation"]');
    expect(acciones.length).toBe(0);
  });
});
