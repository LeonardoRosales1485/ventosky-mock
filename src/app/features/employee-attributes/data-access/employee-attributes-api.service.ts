import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { EmployeeAttributeDto, EmployeeAttributeSavePayload } from './employee-attribute.model';

@Injectable()
export class EmployeeAttributesApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<EmployeeAttributeDto>> {
    return this.http.post<PaginationData<EmployeeAttributeDto>>(
      apiUrl(API_ENDPOINTS.EMPLOYEE_ATTRIBUTES.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<EmployeeAttributeDto> {
    return this.http.get<EmployeeAttributeDto>(
      apiUrl(`${API_ENDPOINTS.EMPLOYEE_ATTRIBUTES.BY_UUID}/${uuid}`),
    );
  }

  save(attribute: EmployeeAttributeSavePayload): Observable<EmployeeAttributeDto> {
    return this.http.post<EmployeeAttributeDto>(
      apiUrl(API_ENDPOINTS.EMPLOYEE_ATTRIBUTES.SAVE),
      attribute,
    );
  }

  /** Da de baja el campo y, con él, sus valores en todos los empleados. */
  delete(uuid: string): Observable<EmployeeAttributeDto> {
    return this.http.delete<EmployeeAttributeDto>(
      apiUrl(`${API_ENDPOINTS.EMPLOYEE_ATTRIBUTES.DELETE}/${uuid}`),
    );
  }
}
