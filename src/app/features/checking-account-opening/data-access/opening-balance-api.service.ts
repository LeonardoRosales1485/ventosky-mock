import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  OpeningBalanceRequest,
  OpeningImportDto,
  OpeningImportRowDto,
  OpeningPreviewDto,
} from './opening-balance.model';

/**
 * La carga de saldos iniciales: la previa y la carga.
 *
 * **El backend no parsea archivos.** Recibe líneas ya estructuradas, y el CSV se interpreta acá,
 * donde la persona puede ver lo que está mandando. Que el servidor adivine separadores y
 * codificaciones agregaría una capa de errores silenciosos justo sobre el dato que después no se
 * puede auditar contra nada.
 */
@Service()
export class OpeningBalanceApiService {
  private readonly http = inject(HttpClient);

  /** Qué se cargaría. No escribe nada, así que se puede pedir cuantas veces haga falta. */
  preview(request: OpeningBalanceRequest): Observable<OpeningPreviewDto> {
    return this.http.post<OpeningPreviewDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNT_OPENING.PREVIEW),
      request,
    );
  }

  /**
   * Carga. Revalida todo de nuevo —la previa pudo haber corrido hace veinte minutos— y saltea lo que
   * ya exista: cargar dos veces el mismo archivo devuelve `createdCount: 0`.
   */
  execute(request: OpeningBalanceRequest): Observable<OpeningImportDto> {
    return this.http.post<OpeningImportDto>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNT_OPENING.IMPORT),
      request,
    );
  }

  /**
   * Las cargas que ya se hicieron, de la más nueva a la más vieja.
   *
   * Es lo único que contesta «estas 40 deudas, ¿de dónde salieron?», que sobre un saldo inicial no
   * lo contesta ningún otro dato del módulo. Los totales se **guardan** y no se recalculan: son los
   * que una persona aprobó en la previa, y compararlos después contra la suma de las partidas es
   * cómo se detecta que alguien tocó algo.
   */
  history(query: PaginateQuery): Observable<PaginationData<OpeningImportRowDto>> {
    return this.http.post<PaginationData<OpeningImportRowDto>>(
      apiUrl(API_ENDPOINTS.CHECKING_ACCOUNT_OPENING.PAGINATE),
      query,
    );
  }
}
