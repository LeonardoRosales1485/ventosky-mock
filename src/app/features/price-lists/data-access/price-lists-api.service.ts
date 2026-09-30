import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { UuidNameRef } from '../../../core/http/api-refs';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  PickerCategoryOption,
  PickerCategoryTreeNode,
  toPickerCategoryOptions,
} from '../../../core/product-picker/product-picker.model';
import { PriceListDto, PriceListSavePayload } from './price-list.model';
import { PriceListProductDto } from './price-list-product.model';

/** Los selects del filtro traen el catálogo entero —es chico— en vez de paginarlo. */
const OPTIONS_PAGE_SIZE = 500;

@Injectable()
export class PriceListsApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<PriceListDto>> {
    return this.http.post<PaginationData<PriceListDto>>(
      apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<PriceListDto> {
    return this.http.get<PriceListDto>(apiUrl(`${API_ENDPOINTS.PRICE_LISTS.BY_UUID}/${uuid}`));
  }

  /**
   * Alta y edición. Requiere `X-Branch-Uuid` —el backend resuelve la sucursal activa incluso cuando
   * el body no trae precios—, que el interceptor de autenticación ya adjunta.
   */
  save(priceList: PriceListSavePayload): Observable<PriceListDto> {
    return this.http.post<PriceListDto>(apiUrl(API_ENDPOINTS.PRICE_LISTS.SAVE), priceList);
  }

  /** Baja lógica; propaga `status = -1` a los precios de la lista. */
  delete(uuid: string): Observable<PriceListDto> {
    return this.http.delete<PriceListDto>(apiUrl(`${API_ENDPOINTS.PRICE_LISTS.DELETE}/${uuid}`));
  }

  /**
   * El catálogo completo de la empresa (`/product/paginate-all`), que es de donde salen los precios
   * de la pantalla: cada fila trae sus `priceListEntries` de la sucursal activa.
   *
   * Es el paginado **plano** —las variantes sueltas, no la fila agrupada del modelo— porque acá la
   * unidad es la que tiene precio: el modelo no cotiza, cotizan sus variantes. Exige
   * `product.branch_assign`; un producto recién creado todavía no tiene sucursales y sólo aparece acá.
   */
  paginateProducts(query: PaginateQuery): Observable<PaginationData<PriceListProductDto>> {
    return this.http.post<PaginationData<PriceListProductDto>>(
      apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL),
      query,
    );
  }

  /** Marcas para el filtro, ordenadas por nombre. */
  getBrands(): Observable<UuidNameRef[]> {
    return this.http
      .post<PaginationData<UuidNameRef>>(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * El árbol de categorías aplanado para el filtro. Lo trae este servicio y no el de la feature de
   * categorías porque las features no se importan entre sí: el aplanado ya vive en
   * `core/product-picker`, que es el mismo select que usa el buscador de productos.
   */
  getCategoryOptions(): Observable<PickerCategoryOption[]> {
    return this.http
      .get<PickerCategoryTreeNode[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toPickerCategoryOptions(tree ?? [])));
  }
}
