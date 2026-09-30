import { HttpClient } from '@angular/common/http';
import { computed, inject, Service } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, shareReplay } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { skipGlobalProgress } from '../http/skip-global-progress';
import { BackendInfoDto } from './backend-version.model';

/**
 * Versión del backend, leída de `/actuator/info`.
 *
 * Se pide una sola vez por carga de la app —la versión desplegada no cambia sin recargar— y el
 * error se traga a propósito: es un dato informativo del pie de página, no una precondición para
 * operar, así que un backend caído o viejo tiene que dejar la pantalla igual de usable.
 */
@Service()
export class BackendVersionService {
  private readonly http = inject(HttpClient);

  private readonly info = toSignal(
    this.http
      .get<BackendInfoDto>(apiUrl(API_ENDPOINTS.ACTUATOR.INFO), {
        // Sin barra de progreso global: es una carga de fondo que el usuario no pidió.
        context: skipGlobalProgress(),
      })
      .pipe(
        catchError(() => of(null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      ),
    { initialValue: null },
  );

  /** `null` mientras la respuesta no llegó, y también si falló. */
  readonly version = computed(() => this.info()?.version ?? null);

  /** Fecha de la versión del backend (`YYYY-MM-DD`), si la informa. */
  readonly date = computed(() => this.info()?.date ?? null);
}
