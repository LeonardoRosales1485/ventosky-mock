import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { SKIP_GLOBAL_PROGRESS } from '../http/skip-global-progress';
import { BackendVersionService } from './backend-version.service';

describe('BackendVersionService', () => {
  let service: BackendVersionService;
  let controller: HttpTestingController;

  const infoRequest = () => controller.expectOne(apiUrl(API_ENDPOINTS.ACTUATOR.INFO));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    controller = TestBed.inject(HttpTestingController);
    service = TestBed.inject(BackendVersionService);
  });

  afterEach(() => controller.verify());

  it('exposes the version and its date once the backend answers', () => {
    infoRequest().flush({
      version: '1.2.0',
      date: '2026-08-18',
      coreVersion: '1.1.4-local',
      coreDate: '2026-06-03',
    });

    expect(service.version()).toBe('1.2.0');
    expect(service.date()).toBe('2026-08-18');
  });

  /** Es un dato de pie de página: si el backend no está, la pantalla tiene que seguir usable. */
  it('reports no version when the request fails', () => {
    infoRequest().error(new ProgressEvent('error'), { status: 503, statusText: 'Unavailable' });

    expect(service.version()).toBeNull();
  });

  /** Un backend viejo responde sin las fechas; la versión sigue siendo utilizable. */
  it('tolerates an answer without dates', () => {
    infoRequest().flush({ version: '1.0.0' });

    expect(service.version()).toBe('1.0.0');
    expect(service.date()).toBeNull();
  });

  /** Carga de fondo que el usuario no pidió: no debe encender la barra de progreso global. */
  it('opts out of the global progress bar', () => {
    const request = infoRequest();

    expect(request.request.context.get(SKIP_GLOBAL_PROGRESS)).toBe(true);
    request.flush({ version: '1.2.0' });
  });
});
