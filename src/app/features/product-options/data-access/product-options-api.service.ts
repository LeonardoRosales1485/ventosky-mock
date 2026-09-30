import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { ProductOptionDto, ProductOptionSavePayload } from './product-option.model';

@Injectable()
export class ProductOptionsApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<ProductOptionDto>> {
    return this.http.post<PaginationData<ProductOptionDto>>(
      apiUrl(API_ENDPOINTS.PRODUCT_OPTIONS.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<ProductOptionDto> {
    return this.http.get<ProductOptionDto>(
      apiUrl(`${API_ENDPOINTS.PRODUCT_OPTIONS.BY_UUID}/${uuid}`),
    );
  }

  save(option: ProductOptionSavePayload): Observable<ProductOptionDto> {
    return this.http.post<ProductOptionDto>(apiUrl(API_ENDPOINTS.PRODUCT_OPTIONS.SAVE), option);
  }

  delete(uuid: string): Observable<ProductOptionDto> {
    return this.http.delete<ProductOptionDto>(
      apiUrl(`${API_ENDPOINTS.PRODUCT_OPTIONS.DELETE}/${uuid}`),
    );
  }
}
