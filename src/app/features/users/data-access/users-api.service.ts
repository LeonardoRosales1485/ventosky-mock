import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { UserDto, UserSavePayload } from './user.model';

@Injectable()
export class UsersApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<UserDto>> {
    return this.http.post<PaginationData<UserDto>>(
      apiUrl(API_ENDPOINTS.USERS.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<UserDto> {
    return this.http.get<UserDto>(apiUrl(`${API_ENDPOINTS.USERS.BY_UUID}/${uuid}`));
  }

  save(user: UserSavePayload): Observable<UserDto> {
    return this.http.post<UserDto>(apiUrl(API_ENDPOINTS.USERS.SAVE), user);
  }

  delete(uuid: string): Observable<UserDto> {
    return this.http.delete<UserDto>(apiUrl(`${API_ENDPOINTS.USERS.DELETE}/${uuid}`));
  }
}
