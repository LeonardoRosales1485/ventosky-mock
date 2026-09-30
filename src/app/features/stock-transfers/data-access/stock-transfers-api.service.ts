import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  StockTransferDetail,
  StockTransferDispatchPayload,
  StockTransferRow,
  StockTransferSummary,
  TransferSourceBatch,
} from './stock-transfer.model';

/**
 * Las cuatro lecturas y las dos escrituras del módulo de traslados.
 *
 * El paginado ya viene acotado por el backend a la empresa y a los traslados en los que la sucursal
 * activa es origen o destino, así que la pantalla no manda ningún filtro de aislamiento: el que
 * mandara sería una sugerencia, no una garantía.
 */
@Service()
export class StockTransfersApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<StockTransferRow>> {
    return this.http.post<PaginationData<StockTransferRow>>(
      apiUrl(API_ENDPOINTS.STOCK_TRANSFERS.PAGINATE),
      query,
    );
  }

  /**
   * Cuántos traslados en viaje espera esta sucursal. Se pide aparte del listado porque es un total
   * de la sucursal: contarlo sobre la página cargada mentiría en cuanto hubiera más de una.
   */
  summary(): Observable<StockTransferSummary> {
    return this.http.get<StockTransferSummary>(apiUrl(API_ENDPOINTS.STOCK_TRANSFERS.SUMMARY));
  }

  /** El detalle, que es también lo que imprime el remito: trae las líneas y el membrete. */
  getByUuid(uuid: string): Observable<StockTransferDetail> {
    return this.http.get<StockTransferDetail>(
      apiUrl(`${API_ENDPOINTS.STOCK_TRANSFERS.BY_UUID}/${uuid}`),
    );
  }

  /**
   * Despacha el traslado. Responde `412 STOCK_CONFIRMATION_REQUIRED` cuando el stock no alcanza y
   * la política de la sucursal pide confirmación: el mismo payload con `forceTransfer: true` es la
   * respuesta a esa pregunta, no un request distinto.
   */
  dispatch(payload: StockTransferDispatchPayload): Observable<StockTransferDetail> {
    return this.http.post<StockTransferDetail>(
      apiUrl(API_ENDPOINTS.STOCK_TRANSFERS.DISPATCH),
      payload,
    );
  }

  /** Confirma la recepción. El backend la rechaza si la sucursal activa no es la de destino. */
  receive(uuid: string): Observable<StockTransferDetail> {
    return this.http.post<StockTransferDetail>(
      apiUrl(API_ENDPOINTS.STOCK_TRANSFERS.RECEIVE(uuid)),
      {},
    );
  }

  /**
   * Cancela un traslado en viaje y devuelve la mercadería al depósito de origen recreando cada
   * lote. El backend la rechaza si la sucursal activa no es la de **origen** — espejo de la
   * recepción, que exige estar en la de destino.
   */
  cancel(uuid: string): Observable<StockTransferDetail> {
    return this.http.post<StockTransferDetail>(
      apiUrl(API_ENDPOINTS.STOCK_TRANSFERS.CANCEL(uuid)),
      {},
    );
  }

  /**
   * Lotes con saldo del producto en el depósito de origen, ya ordenados como los consumiría la
   * política de la sucursal: el reparto manual arranca de lo que haría el automático.
   */
  sourceBatches(warehouseUuid: string, productUuid: string): Observable<TransferSourceBatch[]> {
    return this.http.get<TransferSourceBatch[]>(
      apiUrl(API_ENDPOINTS.STOCK_TRANSFERS.SOURCE_BATCHES),
      { params: new HttpParams().set('warehouseUuid', warehouseUuid).set('productUuid', productUuid) },
    );
  }
}
