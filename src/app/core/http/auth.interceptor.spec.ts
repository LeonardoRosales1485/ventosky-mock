import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_KEY } from '../local-storage/local-storage-keys.constants';
import { BRANCH_UUID_KEY, COMPANY_UUID_KEY } from '../tab-context/tab-context-keys.constants';
import { authInterceptor } from './auth.interceptor';
import { allBranchesScope } from './branch-scope';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  /** Dispara un request cualquiera y devuelve el que llegó al backend, ya interceptado. */
  const send = (headers?: Record<string, string>) => {
    http.get('/probe', { headers }).subscribe();
    return controller.expectOne('/probe').request;
  };

  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, 'jwt');
    // Empresa y sucursal se heredan de la semilla, que es lo que hay al abrir la aplicación.
    localStorage.setItem(COMPANY_UUID_KEY, 'empresa');
    localStorage.setItem(BRANCH_UUID_KEY, 'centro');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
  });

  it('declares the session and the context of this tab', () => {
    const request = send();

    expect(request.headers.get('Authorization')).toBe('Bearer jwt');
    expect(request.headers.get('X-Company-Uuid')).toBe('empresa');
    expect(request.headers.get('X-Branch-Uuid')).toBe('centro');
  });

  /**
   * El caso que motivó el aislamiento: con una sola copia compartida, este request salía con la
   * sucursal que había elegido el otro tab y traía su stock, sus precios y sus cajas.
   */
  it('keeps its branch when another tab switches to a different one', () => {
    send();
    localStorage.setItem(BRANCH_UUID_KEY, 'norte');

    expect(send().headers.get('X-Branch-Uuid')).toBe('centro');
  });

  /** La sesión sí es una sola: un refresh en otro tab deja el token nuevo para todos. */
  it('follows the token rotated by another tab', () => {
    send();
    localStorage.setItem(TOKEN_KEY, 'jwt-rotado');

    expect(send().headers.get('Authorization')).toBe('Bearer jwt-rotado');
  });

  it('sends no context headers before there is one', () => {
    localStorage.clear();
    sessionStorage.clear();

    const request = send();

    expect(request.headers.has('Authorization')).toBe(false);
    expect(request.headers.has('X-Company-Uuid')).toBe(false);
    expect(request.headers.has('X-Branch-Uuid')).toBe(false);
  });

  /**
   * Omitir la sucursal no es «no informarla»: el backend lo lee como *todas las sucursales*, y es
   * lo que habilitan `/stock/distribution` y `/warehouse/paginate` con `stock.view_all_branches`.
   */
  it('leaves the branch out when the caller asks for every branch', () => {
    http.get('/probe', { context: allBranchesScope() }).subscribe();
    const request = controller.expectOne('/probe').request;

    expect(request.headers.has('X-Branch-Uuid')).toBe(false);
    // La sesión y la empresa siguen viajando: lo que se amplía es el alcance, no el permiso.
    expect(request.headers.get('Authorization')).toBe('Bearer jwt');
    expect(request.headers.get('X-Company-Uuid')).toBe('empresa');
  });

  it('respects headers the caller set explicitly', () => {
    const request = send({ 'X-Branch-Uuid': 'norte' });

    expect(request.headers.get('X-Branch-Uuid')).toBe('norte');
    expect(request.headers.get('X-Company-Uuid')).toBe('empresa');
  });
});
