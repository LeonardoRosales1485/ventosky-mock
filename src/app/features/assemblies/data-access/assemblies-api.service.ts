import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  AssemblyBackTrace,
  AssemblyDetail,
  AssemblyPayload,
  AssemblyPreview,
  AssemblyRow,
  AssemblyTrace,
  DisassemblyPayload,
  DisassemblyResult,
} from './assembly.model';

/**
 * Las lecturas y las escrituras del módulo de armados.
 *
 * El paginado ya viene acotado por el backend a la empresa y a la sucursal activa, así que la
 * pantalla no manda ningún filtro de aislamiento: el que mandara sería una sugerencia, no una
 * garantía.
 */
@Service()
export class AssembliesApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<AssemblyRow>> {
    return this.http.post<PaginationData<AssemblyRow>>(
      apiUrl(API_ENDPOINTS.ASSEMBLIES.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<AssemblyDetail> {
    return this.http.get<AssemblyDetail>(apiUrl(`${API_ENDPOINTS.ASSEMBLIES.BY_UUID}/${uuid}`));
  }

  /**
   * El cálculo en vivo, sin efectos: cuánto se puede armar y qué componente lo limita, el reparto
   * por lote, el costo del terminado con su desglose y el vencimiento sugerido.
   *
   * Se llama con cada cambio de la pantalla. No reserva lotes ni descuenta nada.
   */
  preview(payload: AssemblyPayload): Observable<AssemblyPreview> {
    return this.http.post<AssemblyPreview>(apiUrl(API_ENDPOINTS.ASSEMBLIES.PREVIEW), payload);
  }

  /** Registra el armado: consume e ingresa en la misma transacción (RN-23). */
  assemble(payload: AssemblyPayload): Observable<AssemblyDetail> {
    return this.http.post<AssemblyDetail>(apiUrl(API_ENDPOINTS.ASSEMBLIES.ASSEMBLE), payload);
  }

  /**
   * Revierte **ese documento**: los componentes vuelven a los lotes de los que salieron y las
   * unidades producidas salen del stock. El backend responde `409 ASSEMBLY_ALREADY_CONSUMED` si
   * esas unidades ya se vendieron o se consumieron.
   */
  cancel(uuid: string): Observable<AssemblyDetail> {
    return this.http.post<AssemblyDetail>(apiUrl(API_ENDPOINTS.ASSEMBLIES.CANCEL(uuid)), {});
  }

  /**
   * Rompe unidades armadas y devuelve los componentes con el costo prorrateado (RN-26).
   *
   * **No revierte ningún documento**: las unidades pueden venir de armados distintos, así que no se
   * reconstruyen los lotes originales.
   */
  disassemble(payload: DisassemblyPayload): Observable<DisassemblyResult> {
    return this.http.post<DisassemblyResult>(
      apiUrl(API_ENDPOINTS.ASSEMBLIES.DISASSEMBLE),
      payload,
    );
  }

  /** Del lote de un componente a los clientes: los tres pasos del recall. */
  traceComponentBatch(batchUuid: string): Observable<AssemblyTrace> {
    return this.http.get<AssemblyTrace>(apiUrl(API_ENDPOINTS.ASSEMBLIES.TRACE_COMPONENT_BATCH), {
      params: new HttpParams().set('batchUuid', batchUuid),
    });
  }

  /** El camino inverso: del terminado hasta los lotes que lo formaron. */
  traceProducedBatch(batchUuid: string): Observable<AssemblyBackTrace> {
    return this.http.get<AssemblyBackTrace>(apiUrl(API_ENDPOINTS.ASSEMBLIES.TRACE_PRODUCED_BATCH), {
      params: new HttpParams().set('batchUuid', batchUuid),
    });
  }
}
