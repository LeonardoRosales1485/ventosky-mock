import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginationData } from '../../../core/paginate';
import { map } from 'rxjs/operators';
import { UuidNameRef } from '../../../core/http/api-refs';
import {
  ProductModelAxisOption,
  ProductModelCategoryOption,
  ProductModelDto,
  ProductModelPriceList,
  ProductModelSavePayload,
} from './product-model.model';

/** Una página que alcanza para llenar un selector sin paginarlo. */
const OPTIONS_PAGE_SIZE = 500;

/** Nodo del árbol de categorías (`CategoryTreeNodeDTO`), tal como lo devuelve `getAllTree`. */
interface CategoryTreeNode {
  uuid: string;
  name: string;
  children?: CategoryTreeNode[];
}

@Injectable()
export class ProductModelsApiService {
  private readonly http = inject(HttpClient);

  /* No hay `paginate` ni `delete`: el modelo se lista dentro del catálogo agrupado de productos
   * —que los pide con `paginate-catalog`— y desde la matriz sólo se lee y se guarda. */

  /** Trae el modelo **con su matriz completa**: es lo que reabre la grilla con lo existente. */
  getByUuid(uuid: string): Observable<ProductModelDto> {
    return this.http.get<ProductModelDto>(apiUrl(`${API_ENDPOINTS.PRODUCT_MODELS.BY_UUID}/${uuid}`));
  }

  /** Guardar el modelo crea o actualiza **N productos**: las variantes de la matriz. */
  save(model: ProductModelSavePayload): Observable<ProductModelDto> {
    return this.http.post<ProductModelDto>(apiUrl(API_ENDPOINTS.PRODUCT_MODELS.SAVE), model);
  }

  /*
   * Lo que sigue son las opciones de los selectores del formulario. Van acá y no en un servicio de
   * `products` porque una feature no importa de otra: la que necesita el dato lo pide, aunque el
   * endpoint sea el mismo que consume otra pantalla.
   */

  /**
   * Los ejes del catálogo de la empresa con sus valores. Es lo que ofrece el paso «en qué se
   * diferencian»: el usuario elige de acá y no escribe valores nuevos, que es lo que distingue una
   * opción de variante de un atributo de categoría (RN-13).
   */
  getAxes(): Observable<ProductModelAxisOption[]> {
    return this.http
      .post<PaginationData<ProductModelAxisOption>>(apiUrl(API_ENDPOINTS.PRODUCT_OPTIONS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'display_order', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /** Un eje con sus valores: el listado no los trae, y la grilla los necesita para los chips. */
  getAxis(uuid: string): Observable<ProductModelAxisOption> {
    return this.http.get<ProductModelAxisOption>(
      apiUrl(`${API_ENDPOINTS.PRODUCT_OPTIONS.BY_UUID}/${uuid}`),
    );
  }

  getBrands(): Observable<UuidNameRef[]> {
    return this.http
      .post<PaginationData<UuidNameRef>>(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /** El árbol de categorías aplanado, con la profundidad para sangrar cada opción. */
  getCategoryOptions(): Observable<ProductModelCategoryOption[]> {
    return this.http
      .get<CategoryTreeNode[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => flattenCategories(tree ?? [], 0)));
  }

  /** Las listas contra las que cotiza cada variante. La de costo no es un precio de venta. */
  getPriceLists(): Observable<ProductModelPriceList[]> {
    return this.http
      .post<PaginationData<ProductModelPriceList>>(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => (data.content ?? []).filter((list) => list.isCost !== true)));
  }
}

function flattenCategories(
  nodes: readonly CategoryTreeNode[],
  depth: number,
): ProductModelCategoryOption[] {
  const options: ProductModelCategoryOption[] = [];
  for (const node of nodes) {
    options.push({ uuid: node.uuid, name: node.name, depth });
    options.push(...flattenCategories(node.children ?? [], depth + 1));
  }
  return options;
}
