import { FilterMatchMode } from './paginate-filter-match-mode';

/** Spring Data style sort metadata on a page response. */
export interface PaginationSort {
  sorted: boolean;
  empty: boolean;
  unsorted: boolean;
}

/** Spring Data style pageable metadata. */
export interface PaginationPageable {
  pageNumber: number;
  pageSize: number;
  sort: PaginationSort;
  offset: number;
  paged: boolean;
  unpaged: boolean;
}

/**
 * Spring Data `Page<T>` response shape used by `POST /{resource}/paginate`.
 * `content` MUST be a generic array.
 */
export interface PaginationData<T> {
  content: T[];
  pageable?: PaginationPageable;
  last: boolean;
  totalElements: number;
  totalPages: number;
  size: number;
  /** 0-based page index from Spring. */
  number: number;
  sort?: PaginationSort;
  first: boolean;
  numberOfElements: number;
  empty: boolean;
}

/** Single filter constraint (column filter UI → backend filtro). */
export interface PaginationFilterConstraint {
  value: string | string[] | number | number[] | boolean | null;
  matchMode: FilterMatchMode | string;
  operator?: 'and' | 'or';
}

/** One SQL WHERE atom for the legacy paginate body. */
export interface PaginateFiltro {
  tabla: string;
  columna: string;
  operacion: string;
  valor: string;
}

/** JOIN descriptor for the legacy paginate body. */
export interface PaginateRelacion {
  tipo: 'left' | 'right' | 'inner' | 'outer';
  desdeTabla: string;
  desdeColumna: string;
  hastaTabla: string;
  hastaColumna: string;
}

/** ORDER BY descriptor for the legacy paginate body. */
export interface PaginateOrden {
  tabla: string;
  columna: string;
  direccion: 'ASC' | 'DESC' | string;
}

/**
 * Request body for `POST /{resource}/paginate` (`PaginateList` on the backend).
 * Outer `filtros` groups are AND; inner groups are OR.
 * `page` is 1-based.
 */
export interface PaginateQuery {
  page: number;
  size: number;
  filtros?: PaginateFiltro[][];
  ordenes?: PaginateOrden[];
  relaciones?: PaginateRelacion[];
}

/** Maps a Material column key → DB table/column for sorting. */
export interface MatTablePaginatorSortConfig {
  tabla: string;
  columna: string;
}

/** Maps a Material column key → DB table/column for filtering. */
export type MatTablePaginatorFilterConfig = Omit<PaginateFiltro, 'valor' | 'operacion'>;

/** Columns included in the global search OR-group. */
export type MatTablePaginatorGlobalSearchConfig = Omit<PaginateFiltro, 'valor' | 'operacion'>;

export type MatTablePaginatorSortConfigMap = Record<string, MatTablePaginatorSortConfig>;
export type MatTablePaginatorFilterConfigMap = Record<string, MatTablePaginatorFilterConfig>;

/**
 * Normalized UI event for Material table + paginator + sort + filters.
 * `pageIndex` is 0-based (Angular Material).
 */
export interface MatTablePaginateEvent {
  pageIndex: number;
  pageSize: number;
  sortActive?: string;
  sortDirection?: 'asc' | 'desc' | '';
  globalFilter?: string | null;
  filters?: Record<string, PaginationFilterConstraint | PaginationFilterConstraint[]>;
}
