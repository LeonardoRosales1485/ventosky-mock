import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import {
  CategoryDto,
  CategoryNodeDto,
  CategorySavePayload,
  CategoryTreeNodeDto,
} from './category.model';

@Injectable()
export class CategoriesApiService {
  private readonly http = inject(HttpClient);

  /** Full category tree: roots with nested `subCategories` (leaf = `null`). */
  getAllTree(): Observable<CategoryTreeNodeDto[]> {
    return this.http.get<CategoryTreeNodeDto[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE));
  }

  /** Root categories as light nodes `{ uuid, name, hasChildren }`. */
  getParents(): Observable<CategoryNodeDto[]> {
    return this.http.get<CategoryNodeDto[]>(apiUrl(API_ENDPOINTS.CATEGORIES.PARENTS));
  }

  /** Immediate children of a category as light nodes. */
  getChildren(uuid: string): Observable<CategoryNodeDto[]> {
    return this.http.get<CategoryNodeDto[]>(
      apiUrl(`${API_ENDPOINTS.CATEGORIES.CHILDREN}/${uuid}`),
    );
  }

  getByUuid(uuid: string): Observable<CategoryDto> {
    return this.http.get<CategoryDto>(
      apiUrl(`${API_ENDPOINTS.CATEGORIES.BY_UUID}/${uuid}`),
    );
  }

  save(category: CategorySavePayload): Observable<CategoryDto> {
    return this.http.post<CategoryDto>(apiUrl(API_ENDPOINTS.CATEGORIES.SAVE), category);
  }

  delete(uuid: string): Observable<CategoryDto> {
    return this.http.delete<CategoryDto>(
      apiUrl(`${API_ENDPOINTS.CATEGORIES.DELETE}/${uuid}`),
    );
  }
}
