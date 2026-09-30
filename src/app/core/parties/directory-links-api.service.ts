import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { skipGlobalProgress } from '../http/skip-global-progress';
import { DetectedDirectoryLinkDto, DirectoryLinkDetectRequest } from './directory-links';

/**
 * Qué vínculos del directorio son unos roles o unos permisos. **Lo decide el backend**, con la firma de permisos de
 * cada vínculo: el front no repite la tabla, sólo pregunta.
 *
 * Lo usan el directorio —el alta y «Dar acceso» piden los datos de lo que detecta— y la pantalla de roles, que
 * avisa qué vínculos detectan los permisos que se van eligiendo.
 */
@Service()
export class DirectoryLinksApiService {
  private readonly http = inject(HttpClient);

  /** Se pide mientras se eligen roles o permisos: no mueve la barra de progreso global. */
  detect(request: DirectoryLinkDetectRequest): Observable<DetectedDirectoryLinkDto[]> {
    return this.http.post<DetectedDirectoryLinkDto[]>(
      apiUrl(API_ENDPOINTS.PARTIES.DIRECTORY_LINKS_DETECT),
      request,
      { context: skipGlobalProgress() },
    );
  }
}
