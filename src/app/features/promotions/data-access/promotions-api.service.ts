import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  CategoryOption,
  CategoryTreeNodeDto,
  toCategoryOptions,
} from '../../../core/category/category-options';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { UuidNameRef } from '../../../core/http/api-refs';
import {
  FilterMatchMode,
  PaginateQuery,
  PaginationData,
  formatPatternFilterValor,
  getOperacionFromFilterMatchMode,
  resolvePaginateSqlDialectConfig,
} from '../../../core/paginate';
import { environment } from '../../../../environments/environment';
import {
  CustomerOption,
  ProductOption,
  PromotionDto,
  PromotionSavePayload,
} from './promotion.model';

/** Los catálogos chicos —sucursales, medios de pago— se traen de una sola vez en lugar de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

/** Resultados que devuelven los buscadores del formulario. */
const SEARCH_PAGE_SIZE = 20;

@Injectable()
export class PromotionsApiService {
  private readonly http = inject(HttpClient);
  private readonly sqlDialect = resolvePaginateSqlDialectConfig(environment.paginateSqlDialect);

  /**
   * Paginado de promociones. Cada fila trae las cinco colecciones de alcance —así las manda el
   * mapper del backend—, que es lo que le permite al listado resumir el conjunto elegible, la
   * audiencia y la condición de pago sin releer cada promoción por uuid.
   */
  paginate(query: PaginateQuery): Observable<PaginationData<PromotionDto>> {
    return this.http.post<PaginationData<PromotionDto>>(
      apiUrl(API_ENDPOINTS.PROMOTIONS.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<PromotionDto> {
    return this.http.get<PromotionDto>(apiUrl(`${API_ENDPOINTS.PROMOTIONS.BY_UUID}/${uuid}`));
  }

  /**
   * Alta y edición. **Discontinuar y reactivar pasan por acá**: son una edición con
   * `isDiscontinued`, no un endpoint propio, y por eso se deshacen sin tocar las fechas.
   */
  save(promotion: PromotionSavePayload): Observable<PromotionDto> {
    return this.http.post<PromotionDto>(apiUrl(API_ENDPOINTS.PROMOTIONS.SAVE), promotion);
  }

  /**
   * **Archivar**: retira la promoción del listado y arrastra sus cinco colecciones de vínculos. No
   * se deshace (ADR-0001), y las ventas donde se aplicó siguen nombrándola por su desglose
   * persistido, así que el rastro no se pierde.
   */
  archive(uuid: string): Observable<PromotionDto> {
    return this.http.delete<PromotionDto>(apiUrl(`${API_ENDPOINTS.PROMOTIONS.DELETE}/${uuid}`));
  }

  /** Árbol de categorías aplanado en opciones, cada una con su linaje resuelto. */
  getCategoryOptions(): Observable<CategoryOption[]> {
    return this.http
      .get<CategoryTreeNodeDto[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toCategoryOptions(tree ?? [])));
  }

  /** Sucursales de la empresa: las que la promoción puede restringir. Vacío ⇒ rige en todas. */
  getBranches(): Observable<UuidNameRef[]> {
    return this.http
      .post<PaginationData<UuidNameRef>>(apiUrl(API_ENDPOINTS.BRANCHES.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /** Medios de pago visibles para la empresa: los globales del sistema más los personalizados. */
  getPaymentMethods(): Observable<UuidNameRef[]> {
    return this.http
      .post<PaginationData<UuidNameRef>>(apiUrl(API_ENDPOINTS.PAYMENT_METHODS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Buscador del conjunto elegible. Usa el paginado operativo (`/product/paginate`), que exige
   * `product.view` y devuelve los productos de la sucursal activa: son los que el usuario puede ver,
   * y por lo tanto los que tiene sentido ofrecerle.
   */
  searchProducts(term: string): Observable<ProductOption[]> {
    const { operacion, valor } = this.containsFilter(term);

    return this.http
      .post<PaginationData<ProductOption>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), {
        page: 1,
        size: SEARCH_PAGE_SIZE,
        // Un solo grupo: nombre O sku, igual que la búsqueda global del listado de productos.
        filtros: [
          [
            { tabla: 't', columna: 'name', operacion, valor },
            { tabla: 't', columna: 'sku', operacion, valor },
          ],
        ],
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Buscador de la audiencia: los roles `CUSTOMER` de la empresa.
   *
   * El filtro y el orden apuntan a `parties` y no a `t`: el paginado de clientes corre sobre
   * `party_roles`, y desde la unificación de terceros el nombre vive un nivel más arriba, en la
   * identidad. Pedirlo como `t.name` es un `400` — la columna no existe.
   *
   * El `uuid` que devuelve es el del **rol**, que es exactamente lo que la audiencia referencia: la
   * contraparte de la venta es `orders.id_party_role`, así que evaluarla es comparar ids.
   */
  searchCustomers(term: string): Observable<CustomerOption[]> {
    const { operacion, valor } = this.containsFilter(term);

    return this.http
      .post<PaginationData<CustomerOption>>(apiUrl(API_ENDPOINTS.CUSTOMERS.PAGINATE), {
        page: 1,
        size: SEARCH_PAGE_SIZE,
        filtros: [
          [
            { tabla: 'parties', columna: 'name', operacion, valor },
            { tabla: 'parties', columna: 'doc_number', operacion, valor },
          ],
        ],
        ordenes: [{ tabla: 'parties', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  private containsFilter(term: string): { operacion: string; valor: string } {
    return {
      operacion: getOperacionFromFilterMatchMode(FilterMatchMode.Contains, this.sqlDialect),
      valor: formatPatternFilterValor(term.trim(), FilterMatchMode.Contains),
    };
  }
}
