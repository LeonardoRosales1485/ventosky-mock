import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { BrandDto, BrandSavePayload } from './brand.model';

@Injectable()
export class BrandsApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<BrandDto>> {
    return this.http.post<PaginationData<BrandDto>>(
      apiUrl(API_ENDPOINTS.BRANDS.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<BrandDto> {
    return this.http.get<BrandDto>(apiUrl(`${API_ENDPOINTS.BRANDS.BY_UUID}/${uuid}`));
  }

  save(brand: BrandSavePayload): Observable<BrandDto> {
    return this.http.post<BrandDto>(apiUrl(API_ENDPOINTS.BRANDS.SAVE), brand);
  }

  delete(uuid: string): Observable<BrandDto> {
    return this.http.delete<BrandDto>(apiUrl(`${API_ENDPOINTS.BRANDS.DELETE}/${uuid}`));
  }
}
