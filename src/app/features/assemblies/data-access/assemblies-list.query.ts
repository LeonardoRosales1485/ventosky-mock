import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  MatTablePaginator,
  MatTablePaginatorFilterConfigMap,
  MatTablePaginatorGlobalSearchConfig,
  MatTablePaginatorSortConfigMap,
  PaginateQuery,
  PaginateRelacion,
  PaginationData,
} from '../../../core/paginate';
import { AssemblyRow } from './assembly.model';

/**
 * Cómo se le pide a `POST /assembly/paginate` el listado de armados.
 *
 * Vive acá y no dentro de la pantalla porque es la traducción del modelo del backend —tablas y
 * columnas reales— y no una decisión de presentación.
 *
 * No lleva `presetFilters`: el aislamiento por empresa y por sucursal lo aplica el backend en
 * `hookPaginatePreQuery`. Mandarlo desde acá sería declarar una regla de seguridad del lado que no
 * la puede garantizar.
 */
export const ASSEMBLY_RELATIONS: readonly PaginateRelacion[] = [
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_product',
    hastaTabla: 'products',
    hastaColumna: 'id',
  },
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_warehouse',
    hastaTabla: 'warehouses',
    hastaColumna: 'id',
  },
];

/** Con qué se reconoce un armado al buscar: su número y qué produjo. */
export const ASSEMBLY_GLOBAL_SEARCH: readonly MatTablePaginatorGlobalSearchConfig[] = [
  { tabla: 't', columna: 'public_id' },
  { tabla: 'products', columna: 'name' },
  { tabla: 'warehouses', columna: 'name' },
];

export const ASSEMBLY_SORT_CONFIG: MatTablePaginatorSortConfigMap = {
  dateCreated: { tabla: 't', columna: 'date_created' },
  publicId: { tabla: 't', columna: 'public_id' },
  assemblyStatus: { tabla: 't', columna: 'assembly_status' },
  quantity: { tabla: 't', columna: 'quantity' },
  product: { tabla: 'products', columna: 'name' },
  warehouse: { tabla: 'warehouses', columna: 'name' },
};

/**
 * Los filtros del wireframe `1t`: producto, depósito, rango de fechas y estado.
 *
 * El estado se compara contra el texto que persiste el backend (`DONE`, `CANCELLED`), que es lo
 * mismo que la fila devuelve. **No hay filtro de «en curso»**: no existe el estado.
 */
export const ASSEMBLY_FILTER_CONFIG: MatTablePaginatorFilterConfigMap = {
  assemblyStatus: { tabla: 't', columna: 'assembly_status' },
  product: { tabla: 't', columna: 'id_product' },
  warehouse: { tabla: 't', columna: 'id_warehouse' },
  dateCreated: { tabla: 't', columna: 'date_created' },
};

/** Orden por defecto: lo último armado primero, que es lo que se cancela o se revisa. */
export const ASSEMBLIES_DEFAULT_SORT_PARAM = 'dateCreated:DESC';

export function createAssembliesPaginator(
  fetchData: (query: PaginateQuery) => Observable<PaginationData<AssemblyRow>>,
): MatTablePaginator<AssemblyRow> {
  return new MatTablePaginator<AssemblyRow>({
    fetchData,
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    relaciones: [...ASSEMBLY_RELATIONS],
    globalSearchConfig: [...ASSEMBLY_GLOBAL_SEARCH],
    sortConfig: ASSEMBLY_SORT_CONFIG,
    filterConfig: ASSEMBLY_FILTER_CONFIG,
  });
}
