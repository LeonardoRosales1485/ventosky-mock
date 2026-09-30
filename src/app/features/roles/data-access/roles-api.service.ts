import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { RoleDto, RoleSavePayload } from './role.model';

@Injectable()
export class RolesApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<RoleDto>> {
    return this.http.post<PaginationData<RoleDto>>(
      apiUrl(API_ENDPOINTS.ROLES.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<RoleDto> {
    return this.http.get<RoleDto>(apiUrl(`${API_ENDPOINTS.ROLES.BY_UUID}/${uuid}`));
  }

  save(role: RoleSavePayload): Observable<RoleDto> {
    return this.http.post<RoleDto>(apiUrl(API_ENDPOINTS.ROLES.SAVE), role);
  }

  delete(uuid: string): Observable<RoleDto> {
    return this.http.delete<RoleDto>(apiUrl(`${API_ENDPOINTS.ROLES.DELETE}/${uuid}`));
  }
}
