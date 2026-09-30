import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { PermissionDto } from './role.model';

@Injectable()
export class PermissionsApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<PermissionDto>> {
    return this.http.post<PaginationData<PermissionDto>>(
      apiUrl(API_ENDPOINTS.PERMISSIONS.PAGINATE),
      query,
    );
  }
}
