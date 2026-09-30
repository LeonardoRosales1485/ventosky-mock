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
import { environment } from '../../../../environments/environment';
import { StockTransferRow } from './stock-transfer.model';

/**
 * Cómo se le pide a `POST /stock-transfer/paginate` el listado de traslados.
 *
 * Vive acá y no dentro de la pantalla porque es la traducción del modelo del backend —tablas y
 * columnas reales— y no una decisión de presentación.
 *
 * No lleva `presetFilters`: el aislamiento por empresa y por sucursal lo aplica el backend en
 * `hookPaginatePreQuery`. Mandarlo desde acá sería declarar una regla de seguridad en el lado que
 * no la puede garantizar.
 */

/**
 * Los JOIN del paginado legacy. El backend sólo emite el de una tabla que un filtro o un orden
 * nombre, así que declararlos todos no le cuesta nada a la consulta sin filtrar.
 *
 * `warehouses` y `branches` entran una sola vez, del lado del **origen**: el motor une por nombre
 * de tabla, así que no puede unir la misma dos veces para ordenar también por el destino. Ordenar
 * por destino queda fuera a propósito en vez de mostrar una flecha que ordenaría por otra cosa.
 */
export const TRANSFER_RELATIONS: readonly PaginateRelacion[] = [
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_source_warehouse',
    hastaTabla: 'warehouses',
    hastaColumna: 'id',
  },
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_source_branch',
    hastaTabla: 'branches',
    hastaColumna: 'id',
  },
];

/** Con qué se reconoce un traslado al buscar: su número y de qué depósito y sucursal salió. */
export const TRANSFER_GLOBAL_SEARCH: readonly MatTablePaginatorGlobalSearchConfig[] = [
  { tabla: 't', columna: 'public_id' },
  { tabla: 'warehouses', columna: 'name' },
  { tabla: 'branches', columna: 'name' },
];

export const TRANSFER_SORT_CONFIG: MatTablePaginatorSortConfigMap = {
  dateCreated: { tabla: 't', columna: 'date_created' },
  publicId: { tabla: 't', columna: 'public_id' },
  transferStatus: { tabla: 't', columna: 'transfer_status' },
  source: { tabla: 'warehouses', columna: 'name' },
};

/**
 * Los filtros de columna. El estado y la modalidad se comparan contra el texto que persiste el
 * backend (`IN_TRANSIT`, `DEFERRED`), que es lo mismo que la fila devuelve.
 */
export const TRANSFER_FILTER_CONFIG: MatTablePaginatorFilterConfigMap = {
  transferStatus: { tabla: 't', columna: 'transfer_status' },
  transferMode: { tabla: 't', columna: 'transfer_mode' },
};

/** Orden por defecto: lo último despachado primero, que es donde está lo que falta recibir. */
export const TRANSFERS_DEFAULT_SORT_PARAM = 'dateCreated:DESC';

/** El paginador del listado de traslados, ya cableado contra el modelo del backend. */
export function createStockTransfersPaginator(
  fetchData: (query: PaginateQuery) => Observable<PaginationData<StockTransferRow>>,
): MatTablePaginator<StockTransferRow> {
  return new MatTablePaginator<StockTransferRow>({
    fetchData,
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    relaciones: [...TRANSFER_RELATIONS],
    globalSearchConfig: [...TRANSFER_GLOBAL_SEARCH],
    sortConfig: TRANSFER_SORT_CONFIG,
    filterConfig: TRANSFER_FILTER_CONFIG,
  });
}
