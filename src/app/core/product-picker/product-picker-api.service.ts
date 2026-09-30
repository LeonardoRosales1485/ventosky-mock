import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginateQuery, PaginationData } from '../paginate';
import {
  PickerCategoryOption,
  PickerCategoryTreeNode,
  PickerProduct,
  PickerUuidNameRef,
  toPickerCategoryOptions,
} from './product-picker.model';

/** Los catálogos de los filtros son chicos: se traen enteros en vez de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

/**
 * Lo que el selector de productos necesita leer. Lo provee el propio diálogo, así que sólo existe
 * mientras está abierto.
 */
@Injectable()
export class ProductPickerApiService {
  private readonly http = inject(HttpClient);

  /**
   * Paginado operativo (`POST /product/paginate`): el catálogo ya acotado por el backend a la
   * sucursal activa, con su stock y sus precios. Es el que pide `product.view` —y no el completo
   * de `/paginate-all`, que exige administrar el catálogo—, así que un cajero puede usarlo.
   */
  paginate(query: PaginateQuery): Observable<PaginationData<PickerProduct>> {
    return this.http.post<PaginationData<PickerProduct>>(
      apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE),
      query,
    );
  }

  /** Marcas del filtro, ordenadas por nombre. */
  getBrands(): Observable<PickerUuidNameRef[]> {
    return this.http
      .post<PaginationData<PickerUuidNameRef>>(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /** Árbol de categorías aplanado en opciones de select, cada una con su subárbol. */
  getCategoryOptions(): Observable<PickerCategoryOption[]> {
    return this.http
      .get<PickerCategoryTreeNode[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toPickerCategoryOptions(tree ?? [])));
  }
}
