import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { Mock, afterEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { VoidPreviewDto } from '../../data-access/checking-account.model';
import { VoidCreditDialogComponent, VoidCreditDialogData } from './void-credit-dialog.component';

const DATA: VoidCreditDialogData = { creditUuid: 'credit-1', publicId: 'REC-000148' };

/** Un cobro de $1.210 en efectivo, aplicado entero a una factura que ya estaba vencida. */
const PREVIEW: VoidPreviewDto = {
  creditUuid: 'credit-1',
  publicId: 'REC-000148',
  amount: 1210,
  cashAmount: 1210,
  balance: 0,
  balanceAfter: 1210,
  lines: [
    {
      debtUuid: 'debt-1',
      debtPublicId: '0001-00000042',
      debtDescription: 'Venta 0001-00000042',
      amount: 1210,
      pendingAmount: 0,
      pendingAmountAfter: 1210,
      state: 'PAGADA',
      stateAfter: 'VENCIDA',
    },
  ],
};

/**
 * El diálogo de anulación: lo que tiene que decir antes de que alguien confirme la operación de más
 * impacto del módulo.
 */
describe('VoidCreditDialogComponent', () => {
  let fixture: ComponentFixture<VoidCreditDialogComponent>;
  let http: HttpTestingController;
  let close: Mock;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const create = (): void => {
    close = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VoidCreditDialogComponent);
    fixture.detectChanges();
  };

  /**
   * La previa y la caja se piden juntas al abrir el diálogo: la plata sale del cajón que está
   * abierto ahora, así que sin la caja no se puede decir si la anulación arranca.
   */
  const answerPreview = (preview: VoidPreviewDto, sessionOpen = true): void => {
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${DATA.creditUuid}/void/preview`))
      .flush(preview);
    http.expectOne(apiUrl(API_ENDPOINTS.CASH_REGISTERS.ENTRY_CONTEXT)).flush({
      cashRegister: {
        uuid: 'cash-register-uuid',
        name: 'Caja 1',
        openSession: sessionOpen ? { sessionState: 'OPEN' } : null,
      },
      autoEnter: true,
      requiresOpeningAmount: !sessionOpen,
      alreadyInSession: sessionOpen,
    });
    fixture.detectChanges();
  };

  const setReason = (reason: string): void => {
    (fixture.componentInstance as unknown as { reason: { set: (value: string) => void } }).reason.set(
      reason,
    );
    fixture.detectChanges();
  };

  const confirm = (): void => {
    (fixture.componentInstance as unknown as { onConfirm: () => void }).onConfirm();
  };

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /**
   * «El diálogo muestra explícitamente qué deudas vuelven a quedar impagas y en cuánto queda el
   * saldo.» Es el aviso que evita la llamada del cliente al día siguiente.
   */
  it('pide la previa al abrirse y dice qué deudas vuelven a quedar impagas', () => {
    create();
    answerPreview(PREVIEW);

    const text = host().textContent ?? '';
    expect(text).toContain('0001-00000042');
    expect(text).toContain('checkingAccounts.voidDialog.debtsBack');
    // El estado en el que queda lo deriva el backend; la pantalla lo pinta.
    expect(host().querySelector('.chip')?.getAttribute('data-state')).toBe('VENCIDA');
  });

  /** El saldo sube por el importe entero: vuelve la deuda que ese dinero había cancelado. */
  it('muestra el saldo antes y después', () => {
    create();
    answerPreview(PREVIEW);

    expect(host().textContent).toContain('1.210');
  });

  /**
   * Un cobro sin imputar se anula igual, y lo único que pasa es que esa plata deja de estar
   * disponible. Decirlo evita que una lista vacía se lea como un error.
   */
  it('explica el caso del cobro sin imputar en vez de mostrar una lista vacia', () => {
    create();
    answerPreview({ ...PREVIEW, lines: [], balance: -1210, balanceAfter: 0 });

    expect(host().textContent).toContain('checkingAccounts.voidDialog.noDebts');
    expect(host().textContent).not.toContain('checkingAccounts.voidDialog.debtsBack');
  });

  /** Sin plata que devolver no se nombra la caja: un aviso de caja ahí sería falso. */
  it('no habla de la caja cuando el cobro no la movio', () => {
    create();
    answerPreview({ ...PREVIEW, cashAmount: 0 });

    expect(host().textContent).not.toContain('checkingAccounts.voidDialog.cashNote');
  });

  /** El motivo es obligatorio: es lo único que va a explicar por qué un recibo dejó de valer. */
  it('no deja confirmar sin un motivo', () => {
    create();
    answerPreview(PREVIEW);

    confirm();
    expect(close).not.toHaveBeenCalled();

    setReason('El cliente pagó con un cheque sin fondos  ');
    confirm();
    // Recortado: los espacios de más no son un motivo.
    expect(close).toHaveBeenCalledWith({ reason: 'El cliente pagó con un cheque sin fondos' });
  });

  /**
   * Una previa que falla no bloquea la anulación: es información, no una validación — la regla la
   * aplica el backend igual.
   */
  it('deja anular aunque la previa falle', () => {
    create();
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CHECKING_ACCOUNTS.CREDIT}/${DATA.creditUuid}/void/preview`))
      .error(new ProgressEvent('error'));
    http.expectOne(apiUrl(API_ENDPOINTS.CASH_REGISTERS.ENTRY_CONTEXT)).flush({
      cashRegister: null,
      autoEnter: false,
      requiresOpeningAmount: false,
      alreadyInSession: false,
    });
    fixture.detectChanges();

    setReason('La transferencia nunca llegó');
    confirm();
    expect(close).toHaveBeenCalledWith({ reason: 'La transferencia nunca llegó' });
  });

  /**
   * Sin sesión abierta la anulación no arranca: la plata sale del cajón que está abierto ahora, e
   * imputarla a una sesión ya cerrada y arqueada dejaría un arqueo firmado que deja de cuadrar.
   *
   * **No es un error de formulario**: no hay nada que corregir en el diálogo, hay que abrir la caja.
   */
  it('frena la anulacion si la caja no tiene sesion abierta', () => {
    create();
    answerPreview(PREVIEW, false);

    setReason('El cliente pagó con un cheque sin fondos');
    expect(host().textContent).toContain('checkingAccounts.voidDialog.noSessionTitle');
    confirm();
    expect(close).not.toHaveBeenCalled();
  });

  /** Un cobro que no movió caja se anula sin sesión: no hay cajón del que sacar nada. */
  it('anula sin sesion un cobro que no movio caja', () => {
    create();
    answerPreview({ ...PREVIEW, cashAmount: 0 }, false);

    setReason('La transferencia nunca llegó');
    expect(host().textContent).not.toContain('checkingAccounts.voidDialog.noSessionTitle');
    confirm();
    expect(close).toHaveBeenCalledWith({ reason: 'La transferencia nunca llegó' });
  });
});
