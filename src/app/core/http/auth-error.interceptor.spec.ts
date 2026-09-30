// `@angular/common/http` inicializa `BrowserXhr` al importarse y necesita el compilador JIT.
import '@angular/compiler';
import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from './api.config';
import { authErrorInterceptor } from './auth-error.interceptor';
import { TokenRefreshService } from './token-refresh.service';

/** La respuesta que da el backend cuando el access token venció (`AuthJwtService | getUser`). */
const expiredTokenError = new HttpErrorResponse({
  status: 401,
  error: { errorCode: 'ACCESS_TOKEN_EXPIRED', userMessage: 'El token de acceso ha expirado.' },
});

/**
 * Corre el interceptor con un `TokenRefreshService` de mentira y devuelve tanto lo que pasó como
 * los requests que llegaron al backend, que es donde se ve si hubo reintento y con qué token.
 */
function intercept(req: HttpRequest<unknown>) {
  const sent: HttpRequest<unknown>[] = [];
  let refreshes = 0;

  const tokenRefresh = {
    refresh: () => {
      refreshes += 1;
      return of('token-nuevo');
    },
  } as unknown as TokenRefreshService;

  const injector = Injector.create({
    providers: [{ provide: TokenRefreshService, useValue: tokenRefresh }],
  });

  const next: HttpHandlerFn = (request) => {
    sent.push(request);
    // El primer intento es el que vence; el reintento ya viaja con el token rotado.
    return sent.length === 1
      ? throwError(() => expiredTokenError)
      : (of(new HttpResponse({ status: 200 })) as Observable<HttpResponse<unknown>>);
  };

  const result = runInInjectionContext(injector, () => authErrorInterceptor(req, next));

  return { result, sent, refreshes: () => refreshes };
}

describe('authErrorInterceptor', () => {
  it('refresca y reintenta el `getMe`, que es un GET al mismo path que el login', async () => {
    const run = intercept(new HttpRequest('GET', apiUrl(API_ENDPOINTS.AUTH.ME)));

    await expect(firstValueFrom(run.result)).resolves.toBeInstanceOf(HttpResponse);
    expect(run.refreshes()).toBe(1);
    expect(run.sent).toHaveLength(2);
    expect(run.sent[1].headers.get('Authorization')).toBe('Bearer token-nuevo');
  });

  it('no refresca en el login: todavía no hay sesión que rotar', async () => {
    const run = intercept(new HttpRequest('POST', apiUrl(API_ENDPOINTS.AUTH.LOGIN), {}));

    await expect(firstValueFrom(run.result)).rejects.toBe(expiredTokenError);
    expect(run.refreshes()).toBe(0);
    expect(run.sent).toHaveLength(1);
  });

  it('no refresca en el refresh: ese pedido *es* la rotación', async () => {
    const run = intercept(new HttpRequest('POST', apiUrl(API_ENDPOINTS.AUTH.REFRESH_TOKEN), {}));

    await expect(firstValueFrom(run.result)).rejects.toBe(expiredTokenError);
    expect(run.refreshes()).toBe(0);
  });

  it('reintenta una sola vez: si el reintento vuelve a vencer, el error sale al llamador', async () => {
    const sent: HttpRequest<unknown>[] = [];
    const tokenRefresh = {
      refresh: () => of('token-nuevo'),
    } as unknown as TokenRefreshService;
    const injector = Injector.create({
      providers: [{ provide: TokenRefreshService, useValue: tokenRefresh }],
    });
    const next: HttpHandlerFn = (request) => {
      sent.push(request);
      return throwError(() => expiredTokenError);
    };

    const result = runInInjectionContext(injector, () =>
      authErrorInterceptor(new HttpRequest('GET', apiUrl(API_ENDPOINTS.AUTH.ME)), next),
    );

    await expect(firstValueFrom(result)).rejects.toBe(expiredTokenError);
    expect(sent).toHaveLength(2);
  });
});
