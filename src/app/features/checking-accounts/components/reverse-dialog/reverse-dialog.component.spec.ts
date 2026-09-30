import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  CheckingAccountAllocationRowDto,
  ReversePreviewDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { CheckingAccountsMockDb } from '../../data-access/checking-accounts-mock.db';
import { ReverseDialogComponent, ReverseDialogData } from './reverse-dialog.component';

const ALLOCATION: CheckingAccountAllocationRowDto = {
  uuid: 'allocation-1',
  dateCreated: '2026-09-01T10:00:00.000',
  entryType: 'ALLOCATION',
  amount: 1000,
  signedAmount: 1000,
  cause: 'MANUAL',
  mode: 'AUTOMATIC',
  reason: null,
  debtUuid: 'debt-1',
  debtPublicId: '0001-00000042',
  creditUuid: 'credit-1',
  creditPublicId: null,
  reversesUuid: null,
  originUuid: null,
};

/** Una deuda que ya vencio: al devolverle pendiente, vuelve a estar VENCIDA. */
const PREVIEW_OVERDUE: ReversePreviewDto = {
  amount: 400,
  activeAmount: 1000,
  activeAmountAfter: 600,
  debtUuid: 'debt-1',
  debtPublicId: '0001-00000042',
  debtDescription: 'Venta 0001-00000042',
  debtPendingAmount: 0,
  debtPendingAmountAfter: 400,
  debtState: 'PAGADA',
  debtStateAfter: 'VENCIDA',
  creditUnallocatedAmount: 0,
  creditUnallocatedAmountAfter: 400,
};

const PREVIEW_NOT_DUE: ReversePreviewDto = {
  ...PREVIEW_OVERDUE,
  debtStateAfter: 'PENDIENTE',
};

describe('ReverseDialogComponent', () => {
  let fixture: ComponentFixture<ReverseDialogComponent>;
  let http: HttpTestingController;
  const closed: unknown[] = [];

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const create = (): void => {
    const data: ReverseDialogData = { allocation: ALLOCATION, activeAmount: 1000 };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService(),
        CheckingAccountsMockDb,
        CheckingAccountsApiService,
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: (value: unknown) => closed.push(value) } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ReverseDialogComponent);
    fixture.detectChanges();
  };

  /**
   * Relojes falsos: la previa se pide con `debounceTime(250)`. El proyecto es zoneless, asi que
   * `fakeAsync` no esta disponible.
   */
  beforeEach(() => {
    vi.useFakeTimers();
    closed.length = 0;
    create();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  /** Deja pasar el debounce y contesta la previa. */
  const settle = (preview: ReversePreviewDto): void => {
    vi.advanceTimersByTime(250);
    http
      .expectOne(
        apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.ALLOCATION}/allocation-1/reverse/preview`),
      )
      .flush(preview);
    fixture.detectChanges();
  };

  /** Arranca proponiendo deshacer todo: es el caso comun. */
  it('abre con todo lo vigente cargado', () => {
    expect(fixture.componentInstance['amount']()).toBe(1000);
    settle(PREVIEW_OVERDUE);
  });

  /**
   * El aviso que justifica el dialogo. El estado lo deriva el backend porque se evalua contra la
   * fecha de hoy: derivarlo aca dejaria que un reloj corrido mostrara un aviso que el sistema no
   * comparte.
   */
  it('avisa que la deuda vuelve a estar vencida', () => {
    fixture.componentInstance['onAmountChange']('400');
    fixture.detectChanges();
    settle(PREVIEW_OVERDUE);

    expect(fixture.componentInstance['stateChanges']()).toBe(true);
    expect(host().textContent).toContain('checkingAccounts.reverseDialog.stateWarning');
  });

  /** Y si no vencio, no hay alarma que dar: PENDIENTE tambien es un cambio, pero no asusta. */
  it('no alarma cuando la deuda vuelve a estar pendiente y no vencida', () => {
    settle(PREVIEW_NOT_DUE);

    expect(host().textContent).toContain('PENDIENTE');
  });

  /**
   * Lo que el dialogo NO dice: nada sobre el limite. Desimputar no mueve el saldo de la cuenta, asi
   * que un aviso de limite seria alarmar por algo que no pasa.
   */
  it('dice que el saldo de la cuenta no cambia', () => {
    settle(PREVIEW_OVERDUE);

    expect(host().textContent).toContain('checkingAccounts.reverseDialog.balanceUnchanged');
  });

  /** El motivo es obligatorio: sin el, no se puede confirmar. */
  it('no deja confirmar sin motivo', () => {
    settle(PREVIEW_OVERDUE);

    expect(fixture.componentInstance['canSubmit']()).toBe(false);

    fixture.componentInstance['reason'].set('Se imputó a la factura equivocada');
    fixture.detectChanges();

    expect(fixture.componentInstance['canSubmit']()).toBe(true);
  });

  /**
   * El importe viaja siempre, incluso cuando coincide con lo vigente: entre que se abrio el dialogo
   * y se confirma, otra persona pudo revertir una parte, y mandarlo explicito hace que el backend
   * rechace en vez de deshacer mas de lo que se vio.
   */
  it('devuelve el importe y el motivo', () => {
    fixture.componentInstance['onAmountChange']('400');
    fixture.componentInstance['reason'].set('Se imputó a la factura equivocada');
    fixture.detectChanges();
    settle(PREVIEW_OVERDUE);

    fixture.componentInstance['onConfirm']();

    expect(closed).toEqual([{ amount: 400, reason: 'Se imputó a la factura equivocada' }]);
  });

  /** Un importe mayor a lo vigente no se puede confirmar, y tampoco dispara la previa. */
  it('no deja desimputar mas de lo vigente', () => {
    settle(PREVIEW_OVERDUE);

    fixture.componentInstance['onAmountChange']('1500');
    fixture.componentInstance['reason'].set('Motivo suficiente');
    fixture.detectChanges();
    vi.advanceTimersByTime(250);

    expect(fixture.componentInstance['canSubmit']()).toBe(false);
  });
});
