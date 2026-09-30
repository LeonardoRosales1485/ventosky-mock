import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginateQuery, PaginationData } from '../paginate';
import { OrderCommitPayload, OrderConvertPayload, OrderDto } from './order-commit.model';

/**
 * Compras y ventas contra `/order`: los dos caminos de escritura —el commit atómico y la conversión
 * de una orden de compra borrador— más las lecturas que comparten sus pantallas. Se provee a nivel
 * componente —no en `root`— para que muera con la pantalla que lo usa.
 */
@Injectable()
export class OrdersApiService {
  private readonly http = inject(HttpClient);

  /**
   * Cierra la operación (`POST /order/commit`). Es atómico: persiste orden, líneas, checkout, pagos,
   * comprobante y movimientos de stock, o no persiste nada. No hay borradores, así que un error acá
   * deja el sistema exactamente como estaba y la pantalla puede reintentar con el mismo carrito.
   *
   * Los que las pantallas tratan distinto:
   * - `409` con `data.stockValidationWarning`: faltante bajo `WARNING_CONFIRMATION`; se reenvía con
   *   `confirmStockOverride: true` cuando el operador confirma. Sólo puede pasar en venta.
   * - `400` "Sin sesión de caja": ninguna sesión cubre la `dateOperation` de la operación.
   */
  commit(payload: OrderCommitPayload): Observable<OrderDto> {
    return this.http.post<OrderDto>(apiUrl(API_ENDPOINTS.ORDERS.COMMIT), payload);
  }

  /**
   * Listado de operaciones (`POST /order/paginate`). Compras y ventas viven en la misma tabla, así
   * que **quien llama decide cuál está listando**: el discriminador es el comprobante
   * (`vouchers.operation_type`) y viaja como un filtro más del query, con su JOIN declarado.
   *
   * El backend sólo acota por empresa: a diferencia de otros paginados, no filtra por la sucursal
   * del header, así que las filas pueden venir de varias sucursales.
   */
  paginate(query: PaginateQuery): Observable<PaginationData<OrderDto>> {
    return this.http.post<PaginationData<OrderDto>>(apiUrl(API_ENDPOINTS.ORDERS.PAGINATE), query);
  }

  /**
   * El detalle de una orden (`GET /order/uuid/{uuid}`). Es la única lectura que trae las **líneas**:
   * el paginado devuelve el encabezado, así que una pantalla que necesite reconstruir la operación
   * —hoy, la edición de una orden de compra— pasa por acá.
   *
   * Trae también la `version`, que es lo que el convert exige para el bloqueo optimista.
   */
  getByUuid(uuid: string): Observable<OrderDto> {
    return this.http.get<OrderDto>(apiUrl(`${API_ENDPOINTS.ORDERS.BY_UUID}/${uuid}`));
  }

  /**
   * Convierte una orden de compra borrador en la compra terminada (`POST /order/{uuid}/convert`).
   *
   * Es la **única edición** que el backend acepta sobre una orden: `/order/save` responde 410, así
   * que una compra cuyo comprobante ya movió stock o balance no se modifica por ningún camino.
   * Reemplaza comprobante, líneas y checkout, y aplica recién ahora los efectos que el commit
   * original no aplicó.
   *
   * Los errores que la pantalla trata distinto:
   * - `409 VERSION_CONFLICT`: la orden cambió desde que se leyó; hay que releerla.
   * - `409 ORDER_ALREADY_APPLIED`: dejó de ser un borrador, así que ya no hay nada que convertir.
   * - `400 ORDER_NOT_CONVERTIBLE`: el comprobante de la orden no es de compra.
   */
  convert(uuid: string, payload: OrderConvertPayload): Observable<OrderDto> {
    return this.http.post<OrderDto>(apiUrl(API_ENDPOINTS.ORDERS.CONVERT(uuid)), payload);
  }
}
