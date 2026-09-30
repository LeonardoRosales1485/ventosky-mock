import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { allBranchesScope } from '../../../core/http/branch-scope';
import {
  PickerCategoryOption,
  PickerCategoryTreeNode,
  toPickerCategoryOptions,
} from '../../../core/product-picker/product-picker.model';
import { ExpirationFilters, ExpirationPageDto, ExpirationSummaryDto } from './expiration.model';

/**
 * El panel de vencimientos: la grilla paginada y sus tres tarjetas. Con `allBranches` se omite
 * `X-Branch-Uuid` y la lectura abarca toda la empresa (exige `stock.view_all_branches`); es la
 * única forma de que el filtro de sucursal signifique algo.
 */
@Service()
export class ExpirationsApiService {
  private readonly http = inject(HttpClient);

  page(
    filters: ExpirationFilters,
    page: number,
    size: number,
    allBranches = false,
  ): Observable<ExpirationPageDto> {
    let params = this.filterParams(filters).set('page', page).set('size', size);
    if (filters.range === 'DAYS' && filters.days != null) {
      params = params.set('days', filters.days);
    }

    return this.http.get<ExpirationPageDto>(apiUrl(API_ENDPOINTS.STOCK.EXPIRATIONS), {
      params,
      ...(allBranches ? { context: allBranchesScope() } : {}),
    });
  }

  summary(filters: ExpirationFilters, allBranches = false): Observable<ExpirationSummaryDto> {
    return this.http.get<ExpirationSummaryDto>(apiUrl(API_ENDPOINTS.STOCK.EXPIRATIONS_SUMMARY), {
      params: this.scopeParams(filters),
      ...(allBranches ? { context: allBranchesScope() } : {}),
    });
  }

  /**
   * El árbol de categorías aplanado para el filtro del panel. Lo trae este servicio y no el de la
   * feature de categorías porque las features no se importan entre sí: el aplanado ya vive en
   * `core/product-picker`, que es el mismo select que usa el buscador de productos.
   */
  getCategoryOptions(): Observable<PickerCategoryOption[]> {
    return this.http
      .get<PickerCategoryTreeNode[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toPickerCategoryOptions(tree ?? [])));
  }

  private filterParams(filters: ExpirationFilters): HttpParams {
    return this.scopeParams(filters).set('range', filters.range);
  }

  private scopeParams(filters: ExpirationFilters): HttpParams {
    let params = new HttpParams();
    if (filters.branch) {
      params = params.set('branch', filters.branch);
    }
    if (filters.warehouse) {
      params = params.set('warehouse', filters.warehouse);
    }
    if (filters.category) {
      params = params.set('category', filters.category);
    }
    return params;
  }
}
