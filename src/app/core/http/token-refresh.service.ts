import { HttpBackend, HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, ReplaySubject, Subject, catchError, map, of, tap, throwError } from 'rxjs';
import { LOGIN_ROUTE } from '../auth/auth.paths';
import { RefreshTokenDto, RefreshTokenRequest } from '../auth/auth.models';
import { LocalStorageService } from '../local-storage/local-storage.service';
import { TabContextStore } from '../tab-context/tab-context.store';
import { API_ENDPOINTS, apiUrl } from './api.config';

/**
 * Rotates JWT tokens without going through HTTP interceptors (`HttpBackend`).
 * Keeps AuthService out of the interceptor DI graph (avoids NG0200 cycles).
 */
@Service()
export class TokenRefreshService {
  /** Bypasses interceptors so refresh never re-enters `authErrorInterceptor`. */
  private readonly http = new HttpClient(inject(HttpBackend));
  private readonly storage = inject(LocalStorageService);
  private readonly tabContext = inject(TabContextStore);
  private readonly router = inject(Router);

  private refreshInFlight$: Observable<string> | null = null;

  private readonly _tokensRotated$ = new Subject<{ token: string; refresh: string }>();
  private readonly _sessionInvalidated$ = new Subject<void>();

  /** Emitted after a successful refresh so session holders can sync in-memory state. */
  readonly tokensRotated$ = this._tokensRotated$.asObservable();

  /** Emitted when refresh fails and the stored session was cleared. */
  readonly sessionInvalidated$ = this._sessionInvalidated$.asObservable();

  /**
   * Rota el access token con el refresh token guardado. Los llamadores concurrentes comparten el
   * mismo pedido en vuelo.
   *
   * El POST lo suscribe **el servicio**, no el llamador: el backend quema el refresh token en el
   * primer uso (`AuthJwtService.refreshToken` lo borra y emite uno nuevo), así que un pedido
   * abortado a mitad de camino igual rota del lado del servidor y la respuesta con el token nuevo se
   * pierde para siempre. Colgado de la suscripción del request que lo disparó —que se corta sola al
   * navegar, al destruirse el componente o al descartarse una emisión de un `switchMap`— eso dejaba
   * en `localStorage` un token ya borrado y el refresh siguiente cerraba la sesión.
   */
  refresh(): Observable<string> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }

    const refreshToken = this.storage.getRefreshToken();
    if (!refreshToken) {
      this.invalidateSession();
      return throwError(() => new Error('Missing refresh token'));
    }

    // `ReplaySubject` y no `shareReplay`: el valor le llega igual al que se suscriba tarde, y
    // desuscribirse no puede cancelar el POST porque la suscripción es de acá abajo.
    const rotated = new ReplaySubject<string>(1);
    this.refreshInFlight$ = rotated.asObservable();

    this.rotate(refreshToken).subscribe({
      next: (token) => rotated.next(token),
      error: (error: unknown) => {
        this.refreshInFlight$ = null;
        this.invalidateSession();
        rotated.error(error);
      },
      complete: () => {
        this.refreshInFlight$ = null;
        rotated.complete();
      },
    });

    return this.refreshInFlight$;
  }

  private rotate(refreshToken: string): Observable<string> {
    const body: RefreshTokenRequest = { refresh: refreshToken };

    return this.http.post<RefreshTokenDto>(apiUrl(API_ENDPOINTS.AUTH.REFRESH_TOKEN), body).pipe(
      tap(({ token, refresh }) => {
        this.storage.setToken(token);
        this.storage.setRefreshToken(refresh);
        this._tokensRotated$.next({ token, refresh });
      }),
      map(({ token }) => token),
      catchError((error: unknown) => this.recoverFromConcurrentRotation(refreshToken, error)),
    );
  }

  /**
   * El refresh token es **uno solo por usuario** y se quema al usarlo, pero la sesión es de todo el
   * navegador y cada tab refresca por su cuenta: con dos solapas abiertas los access token vencen
   * casi juntos, la primera rota y la segunda manda el que la primera ya borró.
   *
   * Ese 401 no significa que la sesión se haya caído. Si el token guardado ya no es el que se mandó,
   * el otro tab rotó recién y dejó en `localStorage` un access token nuevo: se usa ese y listo. No se
   * pide otra rotación —quemaría el token del otro tab y devolvería el problema— ni se cierra la
   * sesión, que además arrastraba a todas las demás solapas por el `storage` event.
   */
  private recoverFromConcurrentRotation(
    sentRefreshToken: string,
    error: unknown,
  ): Observable<string> {
    const storedRefreshToken = this.storage.getRefreshToken();
    const storedToken = this.storage.getToken();

    if (storedRefreshToken === null || storedRefreshToken === sentRefreshToken || !storedToken) {
      return throwError(() => error);
    }

    this._tokensRotated$.next({ token: storedToken, refresh: storedRefreshToken });
    return of(storedToken);
  }

  private invalidateSession(): void {
    this.storage.removeToken();
    this.storage.removeRefreshToken();
    this.tabContext.clear();
    this._sessionInvalidated$.next();
    void this.router.navigateByUrl(LOGIN_ROUTE);
  }
}
