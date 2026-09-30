import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { Mock, afterEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { NoticePreviewDto } from '../../data-access/checking-account.model';
import { DebtNoticeDialogComponent, DebtNoticeDialogData } from './debt-notice-dialog.component';

const DATA: DebtNoticeDialogData = { accountUuid: 'account-1', partyName: 'Distribuidora Sur' };

const PREVIEW: NoticePreviewDto = {
  accountUuid: 'account-1',
  partyName: 'Distribuidora Sur',
  recipient: 'cobranzas@cliente.test',
  subject: 'Detalle de deuda vencida',
  body: '<p>Estimado/a Distribuidora Sur:</p>',
  overdueAmount: 1210,
  debts: [
    {
      uuid: 'debt-1',
      accountUuid: 'account-1',
      publicId: '0001-00000042',
      origin: 'ORDER',
      state: 'VENCIDA',
      amount: 1210,
      pendingAmount: 1210,
      dateIssued: '2026-08-01T10:15:00.000',
      dateDue: '2026-08-31',
      dateDueOriginal: '2026-08-31',
      dateVoided: null,
      description: 'Venta 0001-00000042',
      order: null,
    },
  ],
};

/**
 * El diálogo del aviso: el paso en el que una persona revisa lo que el sistema propone y decide si
 * eso es lo que corresponde decirle a este cliente hoy.
 */
describe('DebtNoticeDialogComponent', () => {
  let fixture: ComponentFixture<DebtNoticeDialogComponent>;
  let http: HttpTestingController;
  let close: Mock;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const previewUrl = (): string =>
    apiUrl(
      `${API_ENDPOINTS.CHECKING_ACCOUNTS.STATEMENT}/${DATA.accountUuid}` +
        API_ENDPOINTS.CHECKING_ACCOUNTS.NOTICE_SUFFIX +
        API_ENDPOINTS.CHECKING_ACCOUNTS.PREVIEW_SUFFIX,
    );

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
    fixture = TestBed.createComponent(DebtNoticeDialogComponent);
    fixture.detectChanges();
  };

  const answerPreview = (preview: NoticePreviewDto): void => {
    http.expectOne(previewUrl()).flush(preview);
    fixture.detectChanges();
  };

  const dialog = (): {
    recipient: { set: (value: string) => void };
    subject: { set: (value: string) => void };
    body: { set: (value: string) => void };
    onConfirm: () => void;
  } =>
    fixture.componentInstance as unknown as {
      recipient: { set: (value: string) => void };
      subject: { set: (value: string) => void };
      body: { set: (value: string) => void };
      onConfirm: () => void;
    };

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /** «Arma el detalle de lo vencido: comprobantes, importes, días.» */
  it('pide la propuesta al abrirse y muestra el detalle de lo vencido', () => {
    create();
    answerPreview(PREVIEW);

    const text = host().textContent ?? '';
    expect(text).toContain('0001-00000042');
    expect(text).toContain('1.210');
  });

  /** «Deja revisarlo y editarlo antes de mandarlo»: el texto que sale es el que quedó acá. */
  it('manda el texto editado, no el propuesto', () => {
    create();
    answerPreview(PREVIEW);

    dialog().subject.set('Segundo aviso por su deuda');
    dialog().body.set('<p>Texto reescrito a mano</p>');
    dialog().onConfirm();

    expect(close).toHaveBeenCalledWith({
      recipient: 'cobranzas@cliente.test',
      subject: 'Segundo aviso por su deuda',
      body: '<p>Texto reescrito a mano</p>',
    });
  });

  /**
   * Un titular sin mail cargado no es un error: el diálogo lo pide. Mandar el aviso al vacío sería
   * peor que pedir la dirección.
   */
  it('sin correo del titular no deja mandar hasta que se indique uno', () => {
    create();
    answerPreview({ ...PREVIEW, recipient: null });

    dialog().onConfirm();
    expect(close).not.toHaveBeenCalled();

    dialog().recipient.set('administracion@cliente.test');
    dialog().onConfirm();
    expect(close).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'administracion@cliente.test' }),
    );
  });

  /**
   * Sin nada vencido el aviso no tiene qué reclamar. Se puede mandar igual —lo decide una persona—
   * pero la pantalla lo dice antes.
   */
  it('avisa cuando no hay nada vencido', () => {
    create();
    answerPreview({ ...PREVIEW, debts: [], overdueAmount: 0 });

    expect(host().textContent).toContain('checkingAccounts.noticeDialog.nothingOverdue');
  });

  /** Sin propuesta no hay nada que revisar: el botón queda apagado en vez de mandar un texto vacío. */
  it('si la propuesta falla no deja mandar nada', () => {
    create();
    http.expectOne(previewUrl()).error(new ProgressEvent('error'));
    fixture.detectChanges();

    dialog().onConfirm();
    expect(close).not.toHaveBeenCalled();
    expect(host().textContent).toContain('checkingAccounts.noticeDialog.previewError');
  });
});
