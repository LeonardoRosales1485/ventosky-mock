import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  OpeningBalanceRequest,
  OpeningPreviewDto,
} from '../../data-access/opening-balance.model';
import { OpeningBalancePage } from './opening-balance.page';

const CSV = [
  'tipo;documento;rol;comprobante;importe;emision;vencimiento',
  'DEUDA;30712345678;CLIENTE;FA-0001;1.200,50;10/06/2026;10/07/2026',
  'SALDO;30712345678;CLIENTE;REC-0001;300,00;02/08/2026;',
].join('\n');

const PREVIEW: OpeningPreviewDto = {
  canImport: true,
  alreadyImported: false,
  alreadyImportedAt: null,
  lineCount: 2,
  newCount: 2,
  duplicateCount: 0,
  errorCount: 0,
  accountCount: 1,
  totalDebt: 1200.5,
  totalCredit: 300,
  totalOverdue: 1200.5,
  lines: [
    {
      line: 1,
      state: 'NUEVA',
      message: null,
      partyRoleUuid: 'role-1',
      partyName: 'Distribuidora Sur',
      role: 'CUSTOMER',
      accountUuid: null,
      type: 'DEBT',
      publicId: 'FA-0001',
      amount: 1200.5,
      dateDue: '2026-07-10',
      overdue: true,
    },
    {
      line: 2,
      state: 'NUEVA',
      message: null,
      partyRoleUuid: 'role-1',
      partyName: 'Distribuidora Sur',
      role: 'CUSTOMER',
      accountUuid: null,
      type: 'CREDIT',
      publicId: 'REC-0001',
      amount: 300,
      dateDue: null,
      overdue: false,
    },
  ],
};

/**
 * La pantalla de saldos iniciales: lo que tiene que mostrar antes de que alguien cargue el único dato
 * del módulo que después no se compara contra nada.
 */
describe('OpeningBalancePage', () => {
  let fixture: ComponentFixture<OpeningBalancePage>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const page = (): {
    onCsvChange: (text: string) => void;
    onPreview: () => void;
    onImport: () => void;
  } =>
    fixture.componentInstance as unknown as {
      onCsvChange: (text: string) => void;
      onPreview: () => void;
      onImport: () => void;
    };

  const previewWith = (csv: string, response: OpeningPreviewDto): OpeningBalanceRequest => {
    page().onCsvChange(csv);
    page().onPreview();
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNT_OPENING.PREVIEW));
    const body = request.request.body as OpeningBalanceRequest;
    request.flush(response);
    fixture.detectChanges();
    return body;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OpeningBalancePage);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /**
   * El backend no parsea archivos: recibe líneas ya estructuradas. Acá se verifica que el CSV real
   * —coma decimal, fecha dd/mm/aaaa, encabezado— llegue traducido.
   */
  it('manda lineas estructuradas y no el archivo', () => {
    const body = previewWith(CSV, PREVIEW);

    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).toMatchObject({
      type: 'DEBT',
      role: 'CUSTOMER',
      partyDocument: '30712345678',
      publicId: 'FA-0001',
      amount: 1200.5,
      dateIssued: '2026-06-10T00:00:00.000',
      dateDue: '2026-07-10',
    });
    // Un saldo a favor no vence: la fila no manda vencimiento aunque la columna esté.
    expect(body.lines[1].dateDue).toBeUndefined();
  });

  /**
   * `totalOverdue` es el número que sorprende: cuánto de lo que se va a cargar YA está vencido. Suele
   * ser la mitad, y verlo antes evita el susto de que el módulo arranque mandando avisos de deuda.
   */
  it('muestra cuanto nace ya vencido', () => {
    previewWith(CSV, PREVIEW);

    expect(host().querySelector('.opening__overdue')?.textContent).toContain('1.200,5');
    expect(host().querySelector('.opening__overdue-chip')).not.toBeNull();
  });

  /** Editar el CSV descarta la previa: una previa que habla de otro archivo es peor que ninguna. */
  it('descarta la previa al editar el archivo', () => {
    previewWith(CSV, PREVIEW);
    expect(host().querySelector('.opening__preview')).not.toBeNull();

    page().onCsvChange(CSV + '\nDEUDA;30712345678;CLIENTE;FA-0002;100;10/06/2026;10/07/2026');
    fixture.detectChanges();

    expect(host().querySelector('.opening__preview')).toBeNull();
  });

  /**
   * Una línea mala frena el lote entero, y la pantalla no ofrece cargar: un saldo inicial a medias no
   * se puede distinguir después de uno completo.
   */
  it('no deja cargar si alguna linea tiene error', () => {
    previewWith(CSV, {
      ...PREVIEW,
      canImport: false,
      errorCount: 1,
      newCount: 1,
      lines: [
        { ...PREVIEW.lines[0], state: 'ERROR', message: 'falta el vencimiento' },
        PREVIEW.lines[1],
      ],
    });

    const button = host().querySelector<HTMLButtonElement>('.opening__preview button');
    expect(button?.disabled).toBe(true);
    expect(host().querySelector('.opening__note--error')).not.toBeNull();
    expect(host().querySelector('.opening__message')?.textContent).toContain(
      'falta el vencimiento',
    );
  });

  /** Las filas que ni siquiera se pudieron leer se muestran todas juntas, con su número. */
  it('lista las filas ilegibles con su numero', () => {
    page().onCsvChange('DEUDA;30712345678;CLIENTE;FA-0001;no-es-un-importe;10/06/2026;10/07/2026');
    page().onPreview();
    fixture.detectChanges();

    // Ninguna fila quedó utilizable, así que no se llamó al backend.
    http.expectNone(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNT_OPENING.PREVIEW));
    expect(host().querySelector('.opening__parse-errors')?.textContent).toContain('importe');
  });

  /**
   * Cargar dos veces no duplica: el resultado lo dice con los dos números, y la pantalla los muestra
   * en vez de esconder el salteo como si fuera un fracaso.
   */
  it('informa cuantas creo y cuantas salteo', () => {
    previewWith(CSV, PREVIEW);

    page().onImport();
    http.expectOne(apiUrl(API_ENDPOINTS.CHECKING_ACCOUNT_OPENING.IMPORT)).flush({
      uuid: 'import-1',
      sourceName: null,
      contentHash: 'a'.repeat(64),
      lineCount: 2,
      createdCount: 0,
      skippedCount: 2,
      accountCount: 1,
      totalDebt: 0,
      totalCredit: 0,
    });
    fixture.detectChanges();

    expect(host().querySelector('.opening__result')).not.toBeNull();
  });
});
