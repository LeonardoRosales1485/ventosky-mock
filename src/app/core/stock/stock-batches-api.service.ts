import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { allBranchesScope } from '../http/branch-scope';
import {
  BatchTraceabilityDto,
  ExpirationWriteOffPayload,
  ExpirationWriteOffResponseDto,
  ProductBatchesDto,
} from './stock-batch.model';

/**
 * Las lecturas de partidas que comparten varias pantallas: la ficha del producto, el punto de
 * venta (para elegir el lote a mano) y la trazabilidad. Viven en `core/` por eso: son de más de un
 * feature. El panel de vencimientos, que es de uno solo, tiene su propio servicio en `features/stock`.
 */
@Service()
export class StockBatchesApiService {
  private readonly http = inject(HttpClient);

  /**
   * Las partidas con saldo de un producto, vencimiento primero, con semáforo. Con `allBranches` la
   * lectura abarca toda la empresa (exige `stock.view_all_branches`); sin él, la sucursal activa.
   */
  getProductBatches(productUuid: string, allBranches = false): Observable<ProductBatchesDto> {
    return this.http.get<ProductBatchesDto>(
      apiUrl(API_ENDPOINTS.STOCK.BATCHES(productUuid)),
      allBranches ? { context: allBranchesScope() } : {},
    );
  }

  /** La vida de una partida: totales, operaciones que la tocaron y kardex (`stock.view`). */
  getTraceability(batchUuid: string): Observable<BatchTraceabilityDto> {
    return this.http.get<BatchTraceabilityDto>(
      apiUrl(API_ENDPOINTS.STOCK.BATCH_TRACEABILITY(batchUuid)),
    );
  }

  /**
   * Baja masiva de vencidos: cada lote sale por su saldo completo con un ajuste de egreso por
   * motivo `EXPIRED` (`stock.expiration_view`). Queda en el kardex, no se borra.
   */
  writeOff(payload: ExpirationWriteOffPayload): Observable<ExpirationWriteOffResponseDto> {
    return this.http.post<ExpirationWriteOffResponseDto>(
      apiUrl(API_ENDPOINTS.STOCK.EXPIRATIONS_WRITE_OFF),
      payload,
    );
  }
}
