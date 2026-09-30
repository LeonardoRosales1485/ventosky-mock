import { Observable } from 'rxjs';
import { OrderDto } from '../../../core/orders/order-commit.model';
import {
  MatTablePaginator,
  MatTablePaginatorFilterConfigMap,
  MatTablePaginatorGlobalSearchConfig,
  MatTablePaginatorSortConfigMap,
  PaginateFiltro,
  PaginateQuery,
  PaginateRelacion,
  PaginationData,
} from '../../../core/paginate';
import { environment } from '../../../../environments/environment';

/**
 * Cómo se le pide a `POST /order/paginate` que devuelva **ventas**.
 *
 * Vive acá y no dentro de la pantalla porque es la traducción del modelo del backend —tablas y
 * columnas reales— y no una decisión de presentación: la orden no tiene columna `type`, así que
 * quién es venta y quién es compra se resuelve en este archivo o no se resuelve en ninguno. Es el
 * espejo de `purchases-list.query.ts`, con el que comparte tabla, endpoint y service.
 */

/**
 * El discriminador. Va como `presetFilterGroups` —no como filtro de columna— porque no es una preferencia
 * del usuario: sin él la pantalla listaría también las compras. Por eso ni la barra de filtros ni
 * "limpiar filtros" lo tocan.
 */
export const SALE_VOUCHER_FILTER: readonly PaginateFiltro[] = [
  { tabla: 'vouchers', columna: 'operation_type', operacion: '=', valor: 'SALE' },
];

/**
 * Los JOIN del paginado legacy. El backend sólo emite el de una tabla que un filtro o un orden
 * nombre, así que declararlos todos no le cuesta nada a la consulta sin filtrar.
 */
export const SALE_RELATIONS: readonly PaginateRelacion[] = [
  // `inner`: el filtro de venta ya descarta la orden sin comprobante.
  {
    tipo: 'inner',
    desdeTabla: 't',
    desdeColumna: 'id_voucher',
    hastaTabla: 'vouchers',
    hastaColumna: 'id',
  },
  // La contraparte es un rol del maestro unificado, y su nombre vive un salto más allá, en la
  // identidad. `left` en los dos: la venta de mostrador va sin tercero.
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_party_role',
    hastaTabla: 'party_roles',
    hastaColumna: 'id',
  },
  {
    tipo: 'left',
    desdeTabla: 'party_roles',
    desdeColumna: 'id_party',
    hastaTabla: 'parties',
    hastaColumna: 'id',
  },
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_branch',
    hastaTabla: 'branches',
    hastaColumna: 'id',
  },
  // El checkout es 1:1 con la orden, pero puede no existir: una venta cerrada contra un comprobante
  // sin efectos —una orden de venta, un presupuesto— no lo lleva, y entonces la fila no tiene total.
  // De ahí que la FK vaya al revés.
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id',
    hastaTabla: 'order_checkouts',
    hastaColumna: 'id_order',
  },
];

/** Con qué se reconoce una venta al buscar: su número, su nota y a quién y con qué se vendió. */
export const SALE_GLOBAL_SEARCH: readonly MatTablePaginatorGlobalSearchConfig[] = [
  { tabla: 't', columna: 'public_id' },
  { tabla: 't', columna: 'observations' },
  { tabla: 'parties', columna: 'name' },
  { tabla: 'vouchers', columna: 'name' },
];

export const SALE_SORT_CONFIG: MatTablePaginatorSortConfigMap = {
  publicId: { tabla: 't', columna: 'public_id' },
  dateOperation: { tabla: 't', columna: 'date_operation' },
  customer: { tabla: 'parties', columna: 'name' },
  voucher: { tabla: 'vouchers', columna: 'name' },
  branch: { tabla: 'branches', columna: 'name' },
  total: { tabla: 'order_checkouts', columna: 'total_amount' },
};

/**
 * Los filtros de columna, siempre por `uuid`: es lo que el backend sabe convertir al tipo nativo de
 * Postgres. Las fechas quedan afuera a propósito — `date_operation` no está entre las columnas que
 * el backend bindea como timestamp, así que compararla contra un texto rompe la consulta.
 */
export const SALE_FILTER_CONFIG: MatTablePaginatorFilterConfigMap = {
  customer: { tabla: 'party_roles', columna: 'uuid' },
  voucher: { tabla: 'vouchers', columna: 'uuid' },
  period: { tabla: 't', columna: 'date_operation' },
};

/**
 * Orden por defecto, en el formato del query param: lo último vendido primero. La pantalla lo
 * inyecta como si viniera en la URL, así que un `sort` explícito lo pisa.
 */
export const SALES_DEFAULT_SORT_PARAM = 'dateOperation:DESC';

/** El paginador del listado de ventas, ya cableado contra el modelo del backend. */
export function createSalesPaginator(
  fetchData: (query: PaginateQuery) => Observable<PaginationData<OrderDto>>,
): MatTablePaginator<OrderDto> {
  return new MatTablePaginator<OrderDto>({
    fetchData,
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    presetFilterGroups: [[...SALE_VOUCHER_FILTER]],
    relaciones: [...SALE_RELATIONS],
    globalSearchConfig: [...SALE_GLOBAL_SEARCH],
    sortConfig: SALE_SORT_CONFIG,
    filterConfig: SALE_FILTER_CONFIG,
  });
}
