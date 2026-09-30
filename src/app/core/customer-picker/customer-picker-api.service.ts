import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginateQuery, PaginationData } from '../paginate';
import { PickerCustomer } from './customer-picker.model';

/**
 * Lo que el selector de clientes necesita leer. Lo provee el propio diálogo, así que sólo existe
 * mientras está abierto.
 */
@Injectable()
export class CustomerPickerApiService {
  private readonly http = inject(HttpClient);

  /** `POST /party/customer/paginate`: los clientes de la empresa, filtrados y ordenados por el backend. */
  paginate(query: PaginateQuery): Observable<PaginationData<PickerCustomer>> {
    return this.http.post<PaginationData<PickerCustomer>>(
      apiUrl(API_ENDPOINTS.CUSTOMERS.PAGINATE),
      query,
    );
  }
}
