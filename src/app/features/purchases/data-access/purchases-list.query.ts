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
 * Cómo se le pide a `POST /order/paginate` que devuelva **compras**.
 *
 * Vive acá y no dentro de la pantalla porque es la traducción del modelo del backend —tablas y
 * columnas reales— y no una decisión de presentación: la orden no tiene columna `type`, así que
 * quién es compra y quién es venta se resuelve en este archivo o no se resuelve en ninguno.
 */

/**
 * El discriminador. Va como `presetFilterGroups` —no como filtro de columna— porque no es una preferencia
 * del usuario: sin él la pantalla listaría también las ventas. Por eso ni la barra de filtros ni
 * "limpiar filtros" lo tocan.
 */
export const PURCHASE_VOUCHER_FILTER: readonly PaginateFiltro[] = [
  { tabla: 'vouchers', columna: 'operation_type', operacion: '=', valor: 'PURCHASE' },
];

/**
 * Los JOIN del paginado legacy. El backend sólo emite el de una tabla que un filtro o un orden
 * nombre, así que declararlos todos no le cuesta nada a la consulta sin filtrar.
 */
export const PURCHASE_RELATIONS: readonly PaginateRelacion[] = [
  // `inner`: el filtro de compra ya descarta la orden sin comprobante.
  {
    tipo: 'inner',
    desdeTabla: 't',
    desdeColumna: 'id_voucher',
    hastaTabla: 'vouchers',
    hastaColumna: 'id',
  },
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id_party_role',
    hastaTabla: 'party_roles',
    hastaColumna: 'id',
  },
  // El nombre del proveedor vive un salto más allá, en la identidad del maestro unificado.
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
  // El checkout es 1:1 con la orden, pero puede no existir: una compra emitida contra un comprobante
  // sin efectos no lo lleva, y entonces la fila no tiene total. De ahí que la FK vaya al revés.
  {
    tipo: 'left',
    desdeTabla: 't',
    desdeColumna: 'id',
    hastaTabla: 'order_checkouts',
    hastaColumna: 'id_order',
  },
];

/** Con qué se reconoce una compra al buscar: su número, su nota y a quién y con qué se compró. */
export const PURCHASE_GLOBAL_SEARCH: readonly MatTablePaginatorGlobalSearchConfig[] = [
  { tabla: 't', columna: 'public_id' },
  { tabla: 't', columna: 'observations' },
  { tabla: 'parties', columna: 'name' },
  { tabla: 'vouchers', columna: 'name' },
];

export const PURCHASE_SORT_CONFIG: MatTablePaginatorSortConfigMap = {
  publicId: { tabla: 't', columna: 'public_id' },
  dateOperation: { tabla: 't', columna: 'date_operation' },
  supplier: { tabla: 'parties', columna: 'name' },
  voucher: { tabla: 'vouchers', columna: 'name' },
  branch: { tabla: 'branches', columna: 'name' },
  total: { tabla: 'order_checkouts', columna: 'total_amount' },
};

/**
 * Los filtros de columna, siempre por `uuid`: es lo que el backend sabe convertir al tipo nativo de
 * Postgres. Las fechas quedan afuera a propósito — `date_operation` no está entre las columnas que
 * el backend bindea como timestamp, así que compararla contra un texto rompe la consulta.
 */
export const PURCHASE_FILTER_CONFIG: MatTablePaginatorFilterConfigMap = {
  supplier: { tabla: 'party_roles', columna: 'uuid' },
  voucher: { tabla: 'vouchers', columna: 'uuid' },
};

/**
 * Orden por defecto, en el formato del query param: lo último comprado primero. La pantalla lo
 * inyecta como si viniera en la URL, así que un `sort` explícito lo pisa.
 */
export const PURCHASES_DEFAULT_SORT_PARAM = 'dateOperation:DESC';

/** El paginador del listado de compras, ya cableado contra el modelo del backend. */
export function createPurchasesPaginator(
  fetchData: (query: PaginateQuery) => Observable<PaginationData<OrderDto>>,
): MatTablePaginator<OrderDto> {
  return new MatTablePaginator<OrderDto>({
    fetchData,
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    presetFilterGroups: [[...PURCHASE_VOUCHER_FILTER]],
    relaciones: [...PURCHASE_RELATIONS],
    globalSearchConfig: [...PURCHASE_GLOBAL_SEARCH],
    sortConfig: PURCHASE_SORT_CONFIG,
    filterConfig: PURCHASE_FILTER_CONFIG,
  });
}
