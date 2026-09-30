import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { API_ENDPOINTS, API_URL } from './api.config';
import { API_ERROR_CODES, hasApiErrorCode } from './api-error.model';
import { RETRIED_AFTER_REFRESH } from './retried-after-refresh';
import { TokenRefreshService } from './token-refresh.service';

const REFRESH_TOKEN_URL = `${API_URL}${API_ENDPOINTS.AUTH.REFRESH_TOKEN}`;
const LOGIN_URL = `${API_URL}${API_ENDPOINTS.AUTH.LOGIN}`;

/**
 * Catches auth-related HTTP failures, refreshes the access token when it has
 * expired, and retries the original request once with the new token.
 *
 * Uses `TokenRefreshService` (not `AuthService`) to avoid a DI cycle through
 * `HttpClient` interceptors.
 */
export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenRefresh = inject(TokenRefreshService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || !isAccessTokenExpired(error)) {
        return throwError(() => error);
      }

      if (req.context.get(RETRIED_AFTER_REFRESH) || shouldSkipTokenRefresh(req)) {
        return throwError(() => error);
      }

      return tokenRefresh.refresh().pipe(
        switchMap((token) =>
          next(
            req.clone({
              setHeaders: { Authorization: `Bearer ${token}` },
              context: req.context.set(RETRIED_AFTER_REFRESH, true),
            }),
          ),
        ),
      );
    }),
  );
};

/**
 * An expired access token is the only 401 worth retrying: the credentials are still valid, the
 * token just aged out. Every other 401 — missing token, wrong format, unknown user — has to reach
 * the caller, so this branches on the backend's `errorCode` rather than on the status alone.
 */
function isAccessTokenExpired(error: HttpErrorResponse): boolean {
  return hasApiErrorCode(error, API_ERROR_CODES.ACCESS_TOKEN_EXPIRED);
}

/**
 * El refresh y el login son los dos pedidos que no se pueden reintentar: uno *es* la rotación y el
 * otro todavía no tiene sesión. `ME` comparte path con `LOGIN` (`/user/login`) y sólo se distingue
 * por el método, así que el login se identifica por `POST` — si no, el `GET` de `getMe()` quedaba
 * marcado como login y su token expirado nunca se refrescaba.
 */
function shouldSkipTokenRefresh(req: HttpRequest<unknown>): boolean {
  return req.method === 'POST' && (req.url === REFRESH_TOKEN_URL || req.url === LOGIN_URL);
}
