import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { ProductCatalogRowDto } from './product-grouping';
import {
  CategoryAttributeDto,
  CategoryOption,
  CategoryTreeNodeDto,
  PriceListDto,
  ProductDto,
  ProductPaginateDto,
  ProductPriceRuleDto,
  ProductSaleStatus,
  saleStatusFlagsOf,
  ProductSavePayload,
  UuidNameRef,
  toCategoryOptions,
} from './product.model';

/** Selects load the whole (small) catalogue in one shot instead of paging. */
const OPTIONS_PAGE_SIZE = 500;

@Injectable()
export class ProductsApiService {
  private readonly http = inject(HttpClient);

  /**
   * Catálogo completo de la empresa (`/product/paginate-all`), no el paginado operativo:
   * un producto recién creado nace sin sucursales y sólo aparece acá. Requiere el permiso
   * `product.branch_assign`.
   */
  paginate(query: PaginateQuery): Observable<PaginationData<ProductPaginateDto>> {
    return this.http.post<PaginationData<ProductPaginateDto>>(
      apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL),
      query,
    );
  }

  /**
   * El catálogo agrupado por modelo: **una fila por modelo** con variantes vivas y una por producto
   * suelto (§5.6).
   *
   * Es un endpoint aparte y no un filtro del anterior porque cambia la unidad de la página: agrupar
   * sobre la página del paginado de productos partía un modelo de dieciséis variantes entre páginas
   * y lo dibujaba repetido en cada una.
   */
  paginateCatalog(query: PaginateQuery): Observable<PaginationData<ProductCatalogRowDto>> {
    return this.http.post<PaginationData<ProductCatalogRowDto>>(
      apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_CATALOG),
      query,
    );
  }

  /**
   * Todas las variantes de un modelo, con su stock y sus precios. Se piden **al expandir** y no con
   * la fila: son dieciséis por modelo y la mayoría no se abre nunca.
   *
   * Sin paginar a propósito: el usuario expandió para verlas todas, y devolverle diez sería el
   * mismo problema que se vino a arreglar.
   */
  variantsOfModel(
    modelUuid: string,
    saleStatus: ProductSaleStatus | null,
  ): Observable<ProductPaginateDto[]> {
    return this.http
      .post<PaginationData<ProductPaginateDto>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL), {
        page: 1,
        size: 500,
        relaciones: [
          {
            tipo: 'inner',
            desdeTabla: 't',
            desdeColumna: 'id_model',
            hastaTabla: 'product_models',
            hastaColumna: 'id',
          },
        ],
        filtros: [
          [{ tabla: 'product_models', columna: 'uuid', operacion: '=', valor: modelUuid }],
          // El mismo estado de circulación que el listado de arriba: expandir un modelo no puede
          // contradecir al filtro que lo trajo. Cada condición va en su propio grupo, que es como el
          // paginado combina con AND.
          ...saleStatusFlagsOf(saleStatus).map((flag) => [
            {
              tabla: 't',
              columna: flag.columna,
              operacion: '=',
              valor: String(flag.value),
            },
          ]),
        ],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Alta y edición del producto. Persiste en una sola operación el producto, sus valores de
   * atributos de categoría, sus precios por lista (en la sucursal activa) y sus sucursales.
   * Con `uuid` es edición y el backend pide `product.edit` en vez de `product.create`.
   */
  save(product: ProductSavePayload): Observable<ProductDto> {
    return this.http.post<ProductDto>(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE), product);
  }

  /**
   * **Archiva** el producto: el borrado lógico del Core (`status = -1`). No se deshace —revivir un
   * registro eliminado está prohibido en `AbstractEntity.setAbstract`—, así que no es lo mismo que
   * discontinuarlo, que apaga las banderas de compra y venta desde la ficha y se revierte (ADR 0001).
   *
   * Arrastra los vínculos a sucursales y proveedores, los códigos de barras, los empaques y la
   * composición del propio kit. Los tres códigos vuelven al pool **sólo si el producto nunca se
   * movió**; el que tiene historia se los queda para siempre.
   *
   * Responde `409 PRODUCT_IN_USE_BY_KIT` si el producto compone un kit vivo: la salida es sacarlo de
   * la composición primero, que es una decisión sobre el kit.
   */
  delete(uuid: string): Observable<ProductDto> {
    return this.http.delete<ProductDto>(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/${uuid}`));
  }

  /**
   * Detalle completo del producto (`GET /product/uuid/{uuid}`): es el único que trae
   * `categoryAttributes`, `priceListEntries` y `branches`, que el paginado no informa y la
   * edición necesita para prellenar el formulario. Los precios corresponden a la sucursal
   * activa (header `X-Branch-Uuid`).
   */
  getByUuid(uuid: string): Observable<ProductDto> {
    return this.http.get<ProductDto>(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${uuid}`));
  }

  /**
   * Atributos efectivos de una categoría: los suyos más los heredados de sus ancestros. Son los
   * únicos `attributeUuid` que el backend acepta para un producto de esa categoría.
   */
  getCategoryAttributes(categoryUuid: string): Observable<CategoryAttributeDto[]> {
    return this.http
      .get<CategoryAttributeDto[]>(apiUrl(`${API_ENDPOINTS.CATEGORIES.ATTRIBUTES}/${categoryUuid}`))
      .pipe(map((attributes) => attributes ?? []));
  }

  /**
   * Regla de precio efectiva del producto en la sucursal activa (`GET /price-rule/product/{uuid}`),
   * resuelta producto → categoría → ancestros. Cuando ninguna regla lo alcanza el backend responde
   * `204`, que `HttpClient` entrega como `null`. Exige el permiso `price_rule.view`.
   */
  getPriceRule(productUuid: string): Observable<ProductPriceRuleDto | null> {
    return this.http.get<ProductPriceRuleDto | null>(
      apiUrl(`${API_ENDPOINTS.PRICE_RULES.BY_PRODUCT}/${productUuid}`),
    );
  }

  /** Brands for the filter select, sorted by name. */
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
   * Proveedores de la empresa, ordenados por nombre: las opciones con las que se vincula el
   * producto a quién se lo compra.
   *
   * El listado sale de `party_roles` (rol `SUPPLIER`) y el nombre vive en `parties` desde la
   * unificación de terceros, así que el orden apunta a esa tabla y no a `t`. Exige
   * `supplier.view`: sin el permiso el formulario no muestra la sección.
   */
  getSuppliers(): Observable<UuidNameRef[]> {
    return this.http
      .post<PaginationData<UuidNameRef>>(apiUrl(API_ENDPOINTS.SUPPLIERS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 'parties', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /** Category tree flattened into select options (each one carrying its subtree). */
  getCategoryOptions(): Observable<CategoryOption[]> {
    return this.http
      .get<CategoryTreeNodeDto[]>(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE))
      .pipe(map((tree) => toCategoryOptions(tree ?? [])));
  }

  /**
   * Price lists that become grid columns: active and never the cost one, which the backend
   * leaves out of `priceListEntries`.
   *
   * `includeCost` las trae todas, la de costo incluida: el historial de precios sí la registra
   * —el costo es una lista más para él— y su curva es justamente contra la que se lee el margen.
   */
  getPriceLists(options?: { includeCost?: boolean }): Observable<PriceListDto[]> {
    const includeCost = options?.includeCost === true;

    return this.http
      .post<PaginationData<PriceListDto>>(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE), {
        page: 1,
        size: OPTIONS_PAGE_SIZE,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      })
      .pipe(
        map((data) =>
          (data.content ?? []).filter(
            (list) => (includeCost || list.isCost !== true) && list.isActive !== false,
          ),
        ),
      );
  }
}
