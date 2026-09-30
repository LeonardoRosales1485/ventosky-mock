import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginateQuery, PaginationData } from '../paginate';
import { BranchDto, BranchSavePayload } from './branch.model';

@Service()
export class BranchesApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<BranchDto>> {
    return this.http.post<PaginationData<BranchDto>>(
      apiUrl(API_ENDPOINTS.BRANCHES.PAGINATE),
      query,
    );
  }

  /** Lists branches for the current company (`X-Company-Uuid`). Exige `branch.view`. */
  listAll(pageSize = 100): Observable<BranchDto[]> {
    return this.paginate({ page: 1, size: pageSize }).pipe(
      map((page) => page.content ?? []),
    );
  }

  /**
   * Las sucursales activas de la empresa, para elegir en cuál operar. Alcanza con pertenecer a la
   * empresa: es el contexto de todos, no la pantalla de sucursales, que sí exige `branch.view`.
   */
  listAvailable(): Observable<BranchDto[]> {
    return this.http.get<BranchDto[]>(apiUrl(API_ENDPOINTS.BRANCHES.AVAILABLE));
  }

  getByUuid(uuid: string): Observable<BranchDto> {
    return this.http.get<BranchDto>(apiUrl(`${API_ENDPOINTS.BRANCHES.BY_UUID}/${uuid}`));
  }

  save(branch: BranchSavePayload): Observable<BranchDto> {
    return this.http.post<BranchDto>(apiUrl(API_ENDPOINTS.BRANCHES.SAVE), branch);
  }

  delete(uuid: string): Observable<BranchDto> {
    return this.http.delete<BranchDto>(apiUrl(`${API_ENDPOINTS.BRANCHES.DELETE}/${uuid}`));
  }
}
