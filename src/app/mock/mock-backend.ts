import {
  FetchBackend,
  HttpBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../core/http/api.config';
import { genericCrud, replay } from './mock-crud';
import { MockError, MockReply, MockRequest, errorBody } from './mock-http';
import { MOCK_ROUTES } from './mock-handlers';

/** Latencia artificial, para que se vean skeletons, spinners y la barra de progreso. */
const MIN_LATENCY_MS = 120;
const MAX_LATENCY_MS = 380;

/**
 * El backend. Reemplaza al `HttpBackend` de Angular: todo lo que el `HttpClient` manda a `apiUrl`
 * se resuelve acá, en el navegador, contra `MockDb`. Lo demás (i18n, imágenes) sale por `fetch`.
 *
 * Orden de resolución: handlers con reglas → ABM genérico → respuesta grabada de staging → 501.
 *
 * Perillas en la URL de la app:
 * - `?mockReset` vuelve a sembrar la base desde el dump.
 * - `?mockError=500` hace fallar todo lo que no sea GET con ese status (409, 400, 401…).
 * - `?mockLatency=0` saca la demora.
 */
@Injectable()
export class MockBackend implements HttpBackend {
  private readonly passthrough = inject(FetchBackend);

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    const url = req.urlWithParams;
    if (!url.startsWith(API_URL)) {
      return this.passthrough.handle(req);
    }

    return new Observable<HttpEvent<unknown>>((observer) => {
      const timer = setTimeout(() => {
        try {
          const reply = this.resolve(req);
          if (reply.status >= 400) {
            throw new MockError(reply.status, 'MOCK_RECORDED_ERROR', 'Error grabado de staging');
          }
          observer.next(
            new HttpResponse({
              url,
              status: reply.status,
              statusText: 'OK',
              body: reply.status === 204 ? null : reply.body,
              headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
            }),
          );
          observer.complete();
        } catch (error) {
          const mockError =
            error instanceof MockError
              ? error
              : new MockError(500, 'MOCK_INTERNAL', error instanceof Error ? error.message : String(error));
          if (!(error instanceof MockError)) {
            console.error('[mock]', req.method, url, error);
          }
          observer.error(
            new HttpErrorResponse({
              url,
              status: mockError.status,
              statusText: mockError.errorCode,
              error: errorBody(mockError),
              headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
            }),
          );
        }
      }, latency());
      return () => clearTimeout(timer);
    });
  }

  private resolve(req: HttpRequest<unknown>): MockReply {
    const relative = req.urlWithParams.slice(API_URL.length) || '/';
    const [path, query = ''] = relative.split('?');
    const request: MockRequest = {
      method: req.method.toUpperCase(),
      path,
      pathWithQuery: relative,
      params: new URLSearchParams(query),
      body: req.body,
      headers: req.headers,
    };

    const forced = pageParam('mockError');
    if (forced && request.method !== 'GET' && !path.startsWith('/user/login')) {
      throw new MockError(Number(forced) || 500, 'MOCK_FORCED_ERROR', `Error forzado (?mockError=${forced})`);
    }

    for (const candidate of MOCK_ROUTES) {
      if (candidate.method !== request.method) {
        continue;
      }
      const match = candidate.pattern.exec(path);
      if (match) {
        const reply = candidate.handle(request, match);
        if (reply) {
          return reply;
        }
      }
    }

    const crud = genericCrud(request);
    if (crud) {
      return crud;
    }

    const recorded = replay(request);
    if (recorded) {
      return recorded;
    }

    // Una acción que el mock no conoce (POST/PUT/DELETE) responde OK con lo que se mandó, para que
    // la pantalla siga su curso. Un GET sin datos sí es un 501: no hay nada razonable que inventar.
    if (request.method !== 'GET') {
      console.warn(`[mock] acción sin handler, se responde eco: ${request.method} ${relative}`, request.body ?? '');
      const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
        ? { uuid: crypto.randomUUID(), ...(request.body as Record<string, unknown>) }
        : (request.body ?? {});
      return { status: 200, body };
    }
    console.warn(`[mock] 501 sin handler: ${request.method} ${relative}`);
    throw new MockError(501, 'MOCK_NOT_IMPLEMENTED', `El mock no implementa ${request.method} ${path}`);
  }
}

function pageParam(name: string): string | null {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

function latency(): number {
  const forced = pageParam('mockLatency');
  if (forced !== null) {
    return Number(forced) || 0;
  }
  return MIN_LATENCY_MS + Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS);
}
