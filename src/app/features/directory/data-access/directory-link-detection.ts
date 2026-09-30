import { Signal, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, concat, map, of, switchMap, timer } from 'rxjs';
import {
  DetectedDirectoryLinkDto,
  DirectoryLinkDetectRequest,
} from '../../../core/parties/directory-links';
import { DirectoryLinksApiService } from '../../../core/parties/directory-links-api.service';

/** Cuánto espera a que el operador termine de elegir roles antes de preguntar. */
const DETECT_DEBOUNCE_MS = 250;

/**
 * - `idle`: no hay nada que detectar —la persona no va a entrar, o no se le da ningún rol—.
 * - `loading`: se está preguntando. El formulario no se guarda hasta saber qué datos pide.
 * - `ready`: `detected` es lo que piden los roles elegidos.
 * - `error`: no se pudo saber. Si falta un vínculo, el backend lo dice al guardar.
 */
export type DirectoryLinkDetectionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DirectoryLinkDetection {
  status: DirectoryLinkDetectionStatus;
  detected: readonly DetectedDirectoryLinkDto[];
}

const IDLE: DirectoryLinkDetection = { status: 'idle', detected: [] };

/** Dos pedidos que detectarían lo mismo: los mismos roles en cualquier orden, la misma ficha y el mismo usuario. */
export function sameDetectRequest(
  a: DirectoryLinkDetectRequest | null,
  b: DirectoryLinkDetectRequest | null,
): boolean {
  return detectRequestKey(a) === detectRequestKey(b);
}

function detectRequestKey(request: DirectoryLinkDetectRequest | null): string {
  if (!request) {
    return '';
  }
  return JSON.stringify([
    [...(request.roleUuids ?? [])].sort(),
    [...(request.permissionUuids ?? [])].sort(),
    request.partyUuid ?? null,
    request.userUuid ?? null,
  ]);
}

/**
 * Qué vínculos piden los roles de un formulario, mientras se eligen. Pregunta al backend cada vez que cambia el
 * pedido —con una espera corta, para no preguntar por cada rol que se agrega de a uno— y descarta la respuesta de
 * un pedido que ya cambió. Mientras pregunta conserva lo último detectado, para que las secciones no parpadeen.
 *
 * Se llama en el inicializador de un campo: necesita el contexto de inyección.
 *
 * @param request el pedido, o `null` cuando no hay nada que detectar.
 */
export function detectDirectoryLinks(
  request: () => DirectoryLinkDetectRequest | null,
): Signal<DirectoryLinkDetection> {
  const api = inject(DirectoryLinksApiService);
  const source = computed(request, { equal: sameDetectRequest });
  let last: readonly DetectedDirectoryLinkDto[] = [];

  const detections: Observable<DirectoryLinkDetection> = toObservable(source).pipe(
    switchMap((current) => {
      if (!current) {
        last = [];
        return of(IDLE);
      }
      return concat(
        of<DirectoryLinkDetection>({ status: 'loading', detected: last }),
        timer(DETECT_DEBOUNCE_MS).pipe(
          switchMap(() => api.detect(current)),
          map((detected): DirectoryLinkDetection => {
            last = detected;
            return { status: 'ready', detected };
          }),
          catchError(() => {
            last = [];
            return of<DirectoryLinkDetection>({ status: 'error', detected: [] });
          }),
        ),
      );
    }),
  );

  return toSignal(detections, { initialValue: IDLE });
}
