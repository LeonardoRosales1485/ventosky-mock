import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
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
  CategoryOption,
  CategoryTreeNodeDto,
  toCategoryOptions,
} from '../../../core/category/category-options';
import {
  PriceListOption,
  PriceRuleDto,
  PriceRuleSavePayload,
  ProductOption,
} from './price-rule.model';

/** Los selects cargan el catálogo (chico) de una sola vez en lugar de paginarlo. */
const OPTIONS_PAGE_SIZE = 500;

/** Resultados que devuelve el buscador de productos del alcance de la regla. */
const PRODUCT_SEARCH_SIZE = 20;

@Injectable()
export class PriceRulesApiService {
  private readonly http = inject(HttpClient);
  private readonly sqlDialect = resolvePaginateSqlDialectConfig(environment.paginateSqlDialect);

  /**
   * Paginado de reglas. No admite filtro por sucursal: la relación regla → listas es 1:N y el SELECT
   * del Core no aplica `DISTINCT`, así que el join duplicaría la regla una vez por lista. A cambio,
   * cada fila trae su grilla `priceLists` completa, que es lo que identifica su alcance.
   */
  paginate(query: PaginateQuery): Observable<PaginationData<PriceRuleDto>> {
    return this.http.post<PaginationData<PriceRuleDto>>(
      apiUrl(API_ENDPOINTS.PRICE_RULES.PAGINATE),
      query,
    );
  }

  /**
   * Detalle de la regla: el único que trae `products` y `categories` —repetidos una vez por sucursal
   * de la regla— además de la grilla de listas de todas sus sucursales.
   */
  getByUuid(uuid: string): Observable<PriceRuleDto> {
    return this.http.get<PriceRuleDto>(apiUrl(`${API_ENDPOINTS.PRICE_RULES.BY_UUID}/${uuid}`));
  }

  /**
   * Alta y edición. Al guardar, el backend recalcula precios con el costo actual, pero **sólo por lo
   * que cambió**: todos los productos de la regla si se tocó el cálculo (`ruleType`, el redondeo o
   * la grilla), sólo los que entraron o salieron si se movieron los vínculos, y ninguno si sólo
   * cambió el nombre. La respuesta implica precios ya persistidos.
   */
  save(priceRule: PriceRuleSavePayload): Observable<PriceRuleDto> {
    return this.http.post<PriceRuleDto>(apiUrl(API_ENDPOINTS.PRICE_RULES.SAVE), priceRule);
  }

  /**
   * Baja lógica; propaga `status = -1` a la grilla de listas y a los vínculos.
   *
   * Los productos que la regla alcanzaba se recalculan después de borrarla: si la categoría —o un
   * ancestro— tiene regla, esa pasa a ser la efectiva y el precio se ajusta a ella. Si no queda
   * ninguna, el precio se congela en su último valor y pasa a ser manual.
   */
  delete(uuid: string): Observable<PriceRuleDto> {
    return this.http.delete<PriceRuleDto>(apiUrl(`${API_ENDPOINTS.PRICE_RULES.DELETE}/${uuid}`));
  }

  /**
   * Listas que la regla puede recalcular: activas y nunca la de costo, que el backend rechaza como
   * destino (la regla calcula el precio *a partir* del costo: sería un bucle).
   */
  getPriceLists(): Observable<PriceListOption[]> {
    return this.http
      .post<PaginationData<PriceListOption>>(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(
        map((data) =>
          (data.content ?? []).filter((list) => list.isCost !== true && list.isActive !== false),
        ),
      );
  }

  /** Árbol de categorías aplanado en opciones, cada una con su linaje resuelto. */
  getCategoryOptions(): Observable<CategoryOption[]> {
    return this.http
      .get<CategoryTreeNodeDto[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toCategoryOptions(tree ?? [])));
  }

  /**
   * Buscador de productos del alcance de la regla. Usa el paginado operativo (`/product/paginate`),
   * que exige `product.view` y devuelve los productos de la sucursal activa: son los que el usuario
   * puede ver, y por lo tanto los que tiene sentido ofrecerle para vincular.
   */
  searchProducts(term: string): Observable<ProductOption[]> {
    const operacion = getOperacionFromFilterMatchMode(FilterMatchMode.Contains, this.sqlDialect);
    const valor = formatPatternFilterValor(term.trim(), FilterMatchMode.Contains);

    return this.http
      .post<PaginationData<ProductOption>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), {
        page: 1,
        size: PRODUCT_SEARCH_SIZE,
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
}
