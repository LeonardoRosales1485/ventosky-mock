import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import {
  PartyMergeDto,
  PartyMergePreviewDto,
  PartyMergeRequest,
  PartyMergeSideDto,
} from './party-merge.model';

/**
 * La fusión de terceros duplicados: los candidatos, la previa y la ejecución.
 *
 * Los tres son la misma operación mirada en tres momentos —qué se puede fusionar, qué pasaría y qué
 * pasó—, y por eso viven juntos también acá.
 */
@Service()
export class PartyMergeApiService {
  private readonly http = inject(HttpClient);

  /**
   * Los terceros que comparten número de documento con otro.
   *
   * **Que la lista salga corta es lo esperado**: el backend ya impide dos activos con el mismo par
   * (tipo, número), así que acá caen los duplicados que se cuelan por el tipo — el mismo CUIT
   * cargado una vez como CUIT y otra como DNI.
   */
  candidates(): Observable<readonly PartyMergeSideDto[]> {
    return this.http.get<readonly PartyMergeSideDto[]>(
      apiUrl(API_ENDPOINTS.PARTY_MERGE.CANDIDATES),
    );
  }

  /** Qué se movería. No escribe nada, así que se puede pedir cuantas veces haga falta. */
  preview(request: PartyMergeRequest): Observable<PartyMergePreviewDto> {
    return this.http.post<PartyMergePreviewDto>(apiUrl(API_ENDPOINTS.PARTY_MERGE.PREVIEW), request);
  }

  /**
   * Fusiona. **Es irreversible en la práctica**: no hay operación que la deshaga, y por eso la
   * pantalla no llama acá sin haber mostrado la previa completa.
   */
  execute(request: PartyMergeRequest): Observable<PartyMergeDto> {
    return this.http.post<PartyMergeDto>(apiUrl(API_ENDPOINTS.PARTY_MERGE.EXECUTE), request);
  }
}
