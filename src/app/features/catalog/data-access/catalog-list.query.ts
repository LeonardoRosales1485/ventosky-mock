import { Observable } from 'rxjs';
import {
  MatTablePaginator,
  MatTablePaginatorFilterConfigMap,
  MatTablePaginatorGlobalSearchConfig,
  MatTablePaginatorSortConfigMap,
  PaginateQuery,
  PaginateRelacion,
  PaginationData,
} from '../../../core/paginate';
import { PickerProduct } from '../../../core/product-picker/product-picker.model';
import { environment } from '../../../../environments/environment';

/**
 * Cómo se le pide a `POST /product/paginate` el catálogo de la sucursal activa.
 *
 * Es el mismo paginado que usa el selector de productos del mostrador: el backend ya lo acota a la
 * sucursal del header con `product.view`, y le recorta a quien no opera lo que no le corresponde —el
 * costo, los precios de lista, el saldo—. Acá no se decide nada de eso: sólo se nombran las tablas por
 * las que se busca, se ordena y se filtra.
 */

/** Los JOIN sólo se emiten cuando un filtro o un orden nombra la tabla. */
export const CATALOG_RELATIONS: readonly PaginateRelacion[] = [
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_brand',
    hastaTabla: 'brands',
    hastaColumna: 'id',
  },
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_category',
    hastaTabla: 'categories',
    hastaColumna: 'id',
  },
];

/** Con qué se reconoce un producto al buscar: como en el mostrador, nombre, SKU y código de barras. */
export const CATALOG_GLOBAL_SEARCH: readonly MatTablePaginatorGlobalSearchConfig[] = [
  { tabla: 't', columna: 'name' },
  { tabla: 't', columna: 'sku' },
  { tabla: 't', columna: 'barcode' },
];

export const CATALOG_SORT_CONFIG: MatTablePaginatorSortConfigMap = {
  name: { tabla: 't', columna: 'name' },
  brand: { tabla: 'brands', columna: 'name' },
  category: { tabla: 'categories', columna: 'name' },
};

/** Los filtros de columna, por `uuid`: es lo que el backend sabe convertir al tipo nativo de Postgres. */
export const CATALOG_FILTER_CONFIG: MatTablePaginatorFilterConfigMap = {
  brand: { tabla: 'brands', columna: 'uuid' },
  category: { tabla: 'categories', columna: 'uuid' },
};

/** Orden por defecto, en el formato del query param: alfabético, que es como se busca un catálogo. */
export const CATALOG_DEFAULT_SORT_PARAM = 'name:ASC';

/** El paginador del catálogo, ya cableado contra el modelo del backend. */
export function createCatalogPaginator(
  fetchData: (query: PaginateQuery) => Observable<PaginationData<PickerProduct>>,
): MatTablePaginator<PickerProduct> {
  return new MatTablePaginator<PickerProduct>({
    fetchData,
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 25,
    relaciones: [...CATALOG_RELATIONS],
    globalSearchConfig: [...CATALOG_GLOBAL_SEARCH],
    sortConfig: CATALOG_SORT_CONFIG,
    filterConfig: CATALOG_FILTER_CONFIG,
  });
}
