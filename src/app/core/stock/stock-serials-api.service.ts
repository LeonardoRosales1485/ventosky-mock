import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { allBranchesScope } from '../http/branch-scope';
import { ProductSerialsDto, SerialActionPayload, SerialLookupDto } from './stock-serial.model';

/**
 * Las lecturas de series que comparten varias pantallas: la ficha del producto, el punto de venta y
 * la compra (para elegir qué unidades entran o salen) y la consulta de postventa. Viven en `core/`
 * por eso — son de más de un feature.
 */
@Service()
export class StockSerialsApiService {
  private readonly http = inject(HttpClient);

  /**
   * Las unidades de un producto con sus contadores por estado y el chequeo de consistencia
   * (`stock.view`). Con `allBranches` la lectura abarca toda la empresa (exige
   * `stock.view_all_branches`); sin él, la sucursal activa.
   */
  getProductSerials(productUuid: string, allBranches = false): Observable<ProductSerialsDto> {
    return this.http.get<ProductSerialsDto>(
      apiUrl(API_ENDPOINTS.STOCK.SERIALS(productUuid)),
      allBranches ? { context: allBranchesScope() } : {},
    );
  }

  /**
   * La consulta de postventa: con el número en la mano, a quién se le vendió y cuándo
   * (`stock.serial_view`). No acota por sucursal — la garantía se reclama en cualquier mostrador.
   */
  lookup(serialNumber: string): Observable<SerialLookupDto> {
    return this.http.get<SerialLookupDto>(apiUrl(API_ENDPOINTS.STOCK.SERIAL_LOOKUP(serialNumber)));
  }

  /**
   * Registra la devolución de una unidad vendida: pasa a `RETURNED` (`stock.serial_view`). **No
   * suma al saldo**: la unidad queda apartada hasta que alguien la revise y la reingrese.
   */
  registerReturn(payload: SerialActionPayload): Observable<SerialLookupDto> {
    return this.http.post<SerialLookupDto>(apiUrl(API_ENDPOINTS.STOCK.SERIAL_RETURN), payload);
  }

  /**
   * Reingresa al stock una unidad devuelta: vuelve a `IN_STOCK` y **el saldo de su lote sube con
   * ella**. Exige `stock.serial_view` **y** `stock.adjustment` — llegar a la unidad es postventa,
   * mover el saldo es inventario.
   */
  reinstate(payload: SerialActionPayload): Observable<SerialLookupDto> {
    return this.http.post<SerialLookupDto>(apiUrl(API_ENDPOINTS.STOCK.SERIAL_REINSTATE), payload);
  }
}
