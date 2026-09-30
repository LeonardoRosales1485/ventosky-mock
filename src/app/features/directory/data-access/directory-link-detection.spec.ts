import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Signal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { DirectoryLinkDetectRequest } from '../../../core/parties/directory-links';
import {
  DirectoryLinkDetection,
  detectDirectoryLinks,
  sameDetectRequest,
} from './directory-link-detection';

const DETECT_URL = apiUrl(API_ENDPOINTS.PARTIES.DIRECTORY_LINKS_DETECT);

describe('sameDetectRequest', () => {
  it('treats the same roles in another order as the same request', () => {
    expect(
      sameDetectRequest(
        { roleUuids: ['a', 'b'], partyUuid: 'p' },
        { roleUuids: ['b', 'a'], partyUuid: 'p' },
      ),
    ).toBe(true);
    expect(sameDetectRequest({ roleUuids: ['a'] }, { roleUuids: ['a'], userUuid: 'u' })).toBe(
      false,
    );
    expect(sameDetectRequest(null, null)).toBe(true);
  });
});

/**
 * Relojes falsos: la detección espera a que se terminen de elegir los roles. El proyecto es zoneless, así que los
 * efectos se corren con `TestBed.tick()`.
 */
describe('detectDirectoryLinks', () => {
  let http: HttpTestingController;
  let request: ReturnType<typeof signal<DirectoryLinkDetectRequest | null>>;
  let detection: Signal<DirectoryLinkDetection>;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    request = signal<DirectoryLinkDetectRequest | null>(null);
    detection = TestBed.runInInjectionContext(() => detectDirectoryLinks(request));
    TestBed.tick();
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  it('asks nothing while there is nothing to detect', () => {
    vi.advanceTimersByTime(500);

    http.expectNone(DETECT_URL);
    expect(detection()).toEqual({ status: 'idle', detected: [] });
  });

  /** Mientras pregunta no se puede guardar: el formulario todavía no sabe qué datos faltan. */
  it('is loading until the backend answers, and then lists what it detected', () => {
    request.set({ roleUuids: ['role-reparto'], partyUuid: 'party-1' });
    TestBed.tick();

    expect(detection().status).toBe('loading');
    http.expectNone(DETECT_URL);

    vi.advanceTimersByTime(250);
    const call = http.expectOne(DETECT_URL);
    expect(call.request.body).toEqual({ roleUuids: ['role-reparto'], partyUuid: 'party-1' });
    call.flush([{ link: 'TRANSPORTIST', because: ['transfer.dispatch'], alreadyHas: false }]);

    expect(detection()).toEqual({
      status: 'ready',
      detected: [{ link: 'TRANSPORTIST', because: ['transfer.dispatch'], alreadyHas: false }],
    });
  });

  it('does not ask again for the same roles in another order', () => {
    request.set({ roleUuids: ['a', 'b'] });
    TestBed.tick();
    vi.advanceTimersByTime(250);
    http.expectOne(DETECT_URL).flush([]);

    request.set({ roleUuids: ['b', 'a'] });
    TestBed.tick();
    vi.advanceTimersByTime(250);

    http.expectNone(DETECT_URL);
    expect(detection().status).toBe('ready');
  });

  /** Si no se puede saber, el formulario se guarda igual y el backend dice lo que falte. */
  it('reports an error without detecting anything when the backend fails', () => {
    request.set({ roleUuids: ['role-reparto'] });
    TestBed.tick();
    vi.advanceTimersByTime(250);
    http.expectOne(DETECT_URL).flush(null, { status: 500, statusText: 'Error' });

    expect(detection()).toEqual({ status: 'error', detected: [] });
  });
});
