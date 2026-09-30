import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable } from 'rxjs';
import { allBranchesScope } from '../http/branch-scope';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginateQuery, PaginationData } from '../paginate';
import { WarehouseDto, WarehouseSavePayload } from './warehouse.model';

/** Los depósitos de una sucursal son pocos: los selects los traen enteros en vez de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

@Service()
export class WarehousesApiService {
  private readonly http = inject(HttpClient);

  /**
   * El backend acota el listado a la sucursal activa (`X-Branch-Uuid`), sin filtro del front.
   *
   * Con `allBranches` el header no viaja y responde con los depósitos de **toda la empresa**, cada
   * uno con su `branch`; exige `stock.view_all_branches` y responde `403` sin él.
   */
  paginate(query: PaginateQuery, allBranches = false): Observable<PaginationData<WarehouseDto>> {
    return this.http.post<PaginationData<WarehouseDto>>(
      apiUrl(API_ENDPOINTS.WAREHOUSES.PAGINATE),
      query,
      allBranches ? { context: allBranchesScope() } : {},
    );
  }

  /**
   * Depósitos de la sucursal activa para poblar un select, en el mismo orden en que la política
   * `MANUAL_PRIORITY` los va a consumir: el primero de la lista es el primero que se descuenta.
   *
   * `allBranches` los trae de toda la empresa, que es lo que necesita la pantalla de stock para
   * ofrecer el depósito de otra sucursal.
   */
  listAll(allBranches = false, pageSize = OPTIONS_PAGE_SIZE): Observable<WarehouseDto[]> {
    return this.paginate(
      {
        page: 1,
        size: pageSize,
        ordenes: [{ tabla: 't', columna: 'priority', direccion: 'ASC' }],
      },
      allBranches,
    ).pipe(map((page) => page.content ?? []));
  }

  getByUuid(uuid: string): Observable<WarehouseDto> {
    return this.http.get<WarehouseDto>(apiUrl(`${API_ENDPOINTS.WAREHOUSES.BY_UUID}/${uuid}`));
  }

  save(warehouse: WarehouseSavePayload): Observable<WarehouseDto> {
    return this.http.post<WarehouseDto>(apiUrl(API_ENDPOINTS.WAREHOUSES.SAVE), warehouse);
  }

  delete(uuid: string): Observable<WarehouseDto> {
    return this.http.delete<WarehouseDto>(apiUrl(`${API_ENDPOINTS.WAREHOUSES.DELETE}/${uuid}`));
  }
}
