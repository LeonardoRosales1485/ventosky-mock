import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  AllocationTraceDto,
  CheckingAccountAllocationRowDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import {
  AllocationTraceDialogComponent,
  AllocationTraceDialogData,
} from './allocation-trace-dialog.component';

const CREDIT_UUID = 'credit-14';

/** Las dos porciones de un cobro de $10.000 imputadas a mano, de a $5.000, a la misma deuda. */
const FIRST: CheckingAccountAllocationRowDto = {
  uuid: 'alloc-1',
  dateCreated: '2026-09-08T10:00:00.000',
  entryType: 'ALLOCATION',
  amount: 5000,
  signedAmount: 5000,
  cause: 'MANUAL',
  mode: 'MANUAL',
  reason: null,
  debtUuid: 'debt-5',
  debtPublicId: '0001-00000005',
  creditUuid: CREDIT_UUID,
  creditPublicId: 'REC-000014',
  reversesUuid: null,
  originUuid: null,
};

const SECOND: CheckingAccountAllocationRowDto = {
  ...FIRST,
  uuid: 'alloc-2',
  dateCreated: '2026-09-08T10:05:00.000',
};

const TRACE: AllocationTraceDto = {
  allocation: FIRST,
  reversedAmount: 0,
  activeAmount: 5000,
  active: true,
  reversals: [],
  trace: [{ depth: 0, entry: FIRST }],
  debtHistory: [FIRST, SECOND],
};

/**
 * La trazabilidad de una imputación.
 *
 * El caso que la justifica: un cobro de $10.000 repartido a mano en dos porciones de $5.000. Parado
 * en una, **nada en la cadena dice que exista la otra** —dos imputaciones no se encadenan entre sí—
 * y sin el bloque del cobro entero la pantalla no contesta dónde terminó la otra mitad.
 */
describe('AllocationTraceDialogComponent', () => {
  let fixture: ComponentFixture<AllocationTraceDialogComponent>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const create = (data: AllocationTraceDialogData = { allocation: FIRST }): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AllocationTraceDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AllocationTraceDialogComponent);
    fixture.detectChanges();
  };

  /** La traza y, con el uuid del cobro en la mano, su ficha entera en una sola llamada más. */
  const answer = (
    trace: AllocationTraceDto = TRACE,
    allocations: readonly CheckingAccountAllocationRowDto[] = [FIRST, SECOND],
    unallocated = 0,
  ): void => {
    http
      .expectOne(
        apiUrl(
          `${API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION}/${trace.allocation.uuid}` +
            API_ENDPOINTS.CHECKING_ACCOUNTS.TRACE_SUFFIX,
        ),
      )
      .flush(trace);
    fixture.detectChanges();

    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/uuid/${CREDIT_UUID}`))
      .flush({ uuid: CREDIT_UUID, amount: 10000, unallocatedAmount: unallocated, allocations });
    fixture.detectChanges();
  };

  afterEach(() => {
    http.verify();
  });

  /**
   * Dos imputaciones del mismo cobro **no se encadenan**: ninguna deshace a la otra ni salió de la
   * otra. El recorrido de una porción que sigue vigente termina en el nivel 0, y eso es correcto.
   */
  it('el recorrido de una porcion vigente termina en el nivel 0', () => {
    create();
    answer();

    expect(host().querySelectorAll('.trace__step')).toHaveLength(1);
    // Y se dice por qué, para que el nivel 0 solo no se lea como un error.
    expect(host().textContent).toContain('checkingAccounts.traceDialog.chainHint');
  });

  /**
   * El bloque que faltaba: parado en $5.000 de un cobro de $10.000, dónde terminó la otra mitad.
   * Sale de un filtro plano por crédito, sin recursión.
   */
  it('muestra las dos porciones del cobro con su deuda de destino', () => {
    create();
    answer();

    const siblings = host().querySelectorAll('.trace__sibling');
    expect(siblings).toHaveLength(2);
    expect(siblings[0].textContent).toContain('0001-00000005');
    // La que se está mirando queda marcada y no se puede volver a abrir.
    expect((siblings[0] as HTMLButtonElement).disabled).toBe(true);
    expect((siblings[1] as HTMLButtonElement).disabled).toBe(false);
  });

  /** Lo aplicado sale de lo que cada porción sostiene, no de sumar importes a ciegas. */
  it('suma como aplicado solo lo que las porciones sostienen', () => {
    create();
    const reversal: CheckingAccountAllocationRowDto = {
      ...SECOND,
      uuid: 'rev-1',
      entryType: 'REVERSAL',
      signedAmount: -5000,
      reversesUuid: SECOND.uuid,
    };
    answer(TRACE, [FIRST, SECOND, reversal], 5000);

    const page = fixture.componentInstance as unknown as { appliedAmount: () => number };
    expect(page.appliedAmount()).toBe(5000);
    // Y la porción revertida se marca como movida, no como en pie.
    expect(host().textContent).toContain('checkingAccounts.traceDialog.moved');
  });

  /** Desde una porción se salta a la otra sin cerrar el diálogo: eso es el seguimiento. */
  it('al clickear una hermana reabre la traza sobre ella', () => {
    create();
    answer();

    host().querySelectorAll<HTMLButtonElement>('.trace__sibling')[1].click();
    fixture.detectChanges();

    answer({ ...TRACE, allocation: SECOND, trace: [{ depth: 0, entry: SECOND }] });

    expect(host().textContent).toContain('REC-000014');
  });

  /**
   * Los dos anclajes de la tarjeta de la deuda están **sólo** cuando quien abre el diálogo tiene la
   * deuda en la mano: no hay endpoint para leer una suelta, y estimar el importe emitido sumando
   * filas sería inventar el número que la tarjeta existe para verificar.
   */
  it('sin la deuda no inventa el emitido ni el pendiente', () => {
    create();
    answer();

    expect(host().querySelector('.trace__debt-anchor')).toBeNull();
  });

  it('con la deuda cierra la tarjeta entre lo emitido y el pendiente de hoy', () => {
    create({
      allocation: FIRST,
      debt: {
        uuid: 'debt-5',
        accountUuid: 'account-1',
        publicId: '0001-00000005',
        origin: 'ORDER',
        state: 'PARCIAL',
        amount: 40000,
        pendingAmount: 30000,
        dateIssued: '2026-09-08T09:00:00.000',
        dateDue: '2026-10-08',
        dateDueOriginal: '2026-10-08',
        dateVoided: null,
        description: 'Venta 0001-00000005',
        order: null,
      },
    });
    answer();

    const anchors = host().querySelectorAll('.trace__debt-anchor');
    expect(anchors).toHaveLength(2);
    expect(anchors[0].textContent).toContain('40.000');
    expect(anchors[1].textContent).toContain('30.000');
  });

  /**
   * El signo de la tarjeta es el de la **deuda**, no el del libro: una imputación baja el pendiente,
   * y mostrar el `signedAmount` en verde se leía como si la deuda hubiera crecido.
   */
  it('invierte el signo de las filas de la deuda', () => {
    create();
    answer();

    const page = fixture.componentInstance as unknown as {
      debtEffectOf: (entry: CheckingAccountAllocationRowDto) => number;
    };
    expect(page.debtEffectOf(FIRST)).toBe(-5000);
  });
});
