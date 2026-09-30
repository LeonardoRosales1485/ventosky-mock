import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { PartyMergePreviewDto, PartyMergeSideDto } from '../../data-access/party-merge.model';
import { PartyMergePage } from './party-merge.page';

const BUENO: PartyMergeSideDto = {
  uuid: 'party-1',
  name: 'Distribuidora Sur',
  docType: 'CUIT',
  docNumber: '30-11122233-4',
  roles: ['CUSTOMER'],
  orders: 42,
  entries: 12,
  balance: 1000,
  dateCreated: '2024-03-01T10:00:00.000',
};

const DUPLICADO: PartyMergeSideDto = {
  ...BUENO,
  uuid: 'party-2',
  name: 'Distribuidora Sur SA',
  docType: 'DNI',
  orders: 3,
  entries: 2,
  balance: 400,
  dateCreated: '2026-08-01T10:00:00.000',
};

/** Otro documento: la pantalla agrupa, así que dos grupos tienen que verse como dos. */
const OTRO: PartyMergeSideDto = {
  ...BUENO,
  uuid: 'party-3',
  name: 'Ferretería Norte',
  docNumber: '30-99988877-6',
};

const PREVIEW: PartyMergePreviewDto = {
  survivor: BUENO,
  absorbed: DUPLICADO,
  rolesToMove: [],
  rolesToMerge: ['CUSTOMER'],
  ordersToMove: 3,
  entriesToMove: 2,
  contactsToMove: 1,
  resultingBalance: 1400,
};

/**
 * La pantalla de fusión: lo que tiene que mostrar antes de que alguien confirme una operación que no
 * se puede deshacer.
 */
describe('PartyMergePage', () => {
  let fixture: ComponentFixture<PartyMergePage>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const page = (): {
    onPickSurvivor: (uuid: string) => void;
    onPickAbsorbed: (uuid: string) => void;
    onPreview: () => void;
    onMerge: () => void;
    reason: { set: (value: string) => void };
    preview: () => PartyMergePreviewDto | null;
  } =>
    fixture.componentInstance as unknown as {
      onPickSurvivor: (uuid: string) => void;
      onPickAbsorbed: (uuid: string) => void;
      onPreview: () => void;
      onMerge: () => void;
      reason: { set: (value: string) => void };
      preview: () => PartyMergePreviewDto | null;
    };

  const answerCandidates = (candidates: readonly PartyMergeSideDto[]): void => {
    http.expectOne(apiUrl(API_ENDPOINTS.PARTY_MERGE.CANDIDATES)).flush(candidates);
    fixture.detectChanges();
  };

  const pickPair = (): void => {
    page().onPickSurvivor(BUENO.uuid);
    page().onPickAbsorbed(DUPLICADO.uuid);
    fixture.detectChanges();
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
    fixture = TestBed.createComponent(PartyMergePage);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  /** Los candidatos se leen de a duplicado: agrupados por el documento que comparten. */
  it('agrupa los candidatos por documento', () => {
    answerCandidates([BUENO, DUPLICADO, OTRO]);

    const groups = host().querySelectorAll('.merge__group');
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain('Distribuidora Sur');
    expect(groups[0].textContent).toContain('Distribuidora Sur SA');
  });

  /**
   * Cada candidato muestra su historia —desde cuándo, cuántas operaciones, qué saldo—: es lo que
   * permite decidir cuál sobrevive, y sin eso elegir es tirar una moneda.
   */
  it('muestra la historia de cada candidato', () => {
    answerCandidates([BUENO, DUPLICADO]);

    const text = host().querySelector('.merge__group')?.textContent ?? '';
    expect(text).toContain('42');
    expect(text).toContain('1.000');
  });

  /** Que no haya duplicados es lo esperado, y la pantalla lo dice en vez de mostrar un blanco. */
  it('explica la lista vacia', () => {
    answerCandidates([]);

    expect(host().querySelector('.merge__empty')?.textContent).toContain('partyMerge.empty');
  });

  /**
   * «La pantalla tiene que mostrar todo lo que se va a mover antes de confirmar.»
   *
   * Y el saldo resultante es la suma exacta de los dos: las partidas se mueven, no se recalculan.
   */
  it('pide la previa y muestra todo lo que se va a mover', () => {
    answerCandidates([BUENO, DUPLICADO]);
    pickPair();

    page().onPreview();
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PARTY_MERGE.PREVIEW));
    expect(request.request.body).toEqual({
      survivorUuid: BUENO.uuid,
      absorbedUuid: DUPLICADO.uuid,
    });
    request.flush(PREVIEW);
    fixture.detectChanges();

    const preview = host().querySelector('.merge__preview')?.textContent ?? '';
    expect(preview).toContain('partyMerge.rolesToMerge');
    expect(preview).toContain('1.400');
    // Y lo dice: esto no se deshace.
    expect(preview).toContain('partyMerge.irreversible');
  });

  /** Sin motivo no se fusiona: la operación es irreversible y no puede quedar sin explicación. */
  it('no fusiona sin motivo', () => {
    answerCandidates([BUENO, DUPLICADO]);
    pickPair();
    page().onPreview();
    http.expectOne(apiUrl(API_ENDPOINTS.PARTY_MERGE.PREVIEW)).flush(PREVIEW);
    fixture.detectChanges();

    page().onMerge();
    http.expectNone(apiUrl(API_ENDPOINTS.PARTY_MERGE.EXECUTE));

    page().reason.set('Se cargó dos veces el mismo cliente');
    fixture.detectChanges();
    page().onMerge();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.PARTY_MERGE.EXECUTE));
    expect(request.request.body).toEqual({
      survivorUuid: BUENO.uuid,
      absorbedUuid: DUPLICADO.uuid,
      reason: 'Se cargó dos veces el mismo cliente',
    });
    request.flush({ uuid: 'merge-1' });

    // Después de fusionar, la lista se recarga: el absorbido dejó de ser un candidato.
    answerCandidates([]);
  });

  /**
   * Cambiar de pareja descarta la previa: la que estaba hablaba de otros dos terceros, y dejarla a la
   * vista invitaría a confirmar una fusión mirando números de otra.
   */
  it('descarta la previa al cambiar la seleccion', () => {
    answerCandidates([BUENO, DUPLICADO]);
    pickPair();
    page().onPreview();
    http.expectOne(apiUrl(API_ENDPOINTS.PARTY_MERGE.PREVIEW)).flush(PREVIEW);
    fixture.detectChanges();
    expect(page().preview()).not.toBeNull();

    page().onPickAbsorbed(OTRO.uuid);
    fixture.detectChanges();

    expect(page().preview()).toBeNull();
  });
});
