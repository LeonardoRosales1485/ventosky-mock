import { signal } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import { Params } from '@angular/router';
import { Observable } from 'rxjs';
import { LoadState } from '../../shared/components/load-state/load-state.model';
import { FilterMatchMode } from './paginate-filter-match-mode';
import {
  paginateEventToQueryParams,
  queryParamsToPaginateEvent,
} from './paginate-query-params';
import {
  MatTablePaginateEvent,
  MatTablePaginatorFilterConfig,
  MatTablePaginatorFilterConfigMap,
  MatTablePaginatorGlobalSearchConfig,
  MatTablePaginatorSortConfig,
  MatTablePaginatorSortConfigMap,
  PaginateFiltro,
  PaginateOrden,
  PaginateQuery,
  PaginateRelacion,
  PaginationData,
  PaginationFilterConstraint,
} from './paginate.models';
import {
  formatPatternFilterValor,
  getOperacionFromFilterMatchMode as resolveOperacionFromFilterMatchMode,
  isPatternMatchOperation,
  PaginateSqlDialect,
  PaginateSqlDialectConfig,
  resolvePaginateSqlDialectConfig,
} from './paginate-sql-dialect';

export class MatTablePaginator<T> {
  private readonly _items = signal<T[]>([]);
  private readonly _totalCount = signal(0);
  private readonly _totalPages = signal(0);
  /** 0-based, Angular Material. */
  private readonly _pageIndex = signal(0);
  private readonly _pageSize = signal(10);
  private readonly _hasNextPage = signal(false);
  private readonly _hasPreviousPage = signal(false);
  private readonly _firstItemIndex = signal(0);
  private readonly _loadState = signal<LoadState>(LoadState.Idle);
  private readonly _globalFilter = signal('');
  private readonly _sortActive = signal<string | null>(null);
  private readonly _sortDirection = signal<'asc' | 'desc' | ''>('');
  private readonly _filters = signal<
    Record<string, PaginationFilterConstraint | PaginationFilterConstraint[]>
  >({});

  private readonly fetchData: (request: PaginateQuery) => Observable<PaginationData<T>>;
  private readonly globalSearchConfig?: MatTablePaginatorGlobalSearchConfig[];
  private readonly sortConfigByColumnKey = new Map<string, MatTablePaginatorSortConfig>();
  private readonly filterConfigByColumnKey = new Map<string, MatTablePaginatorFilterConfig>();
  private readonly relaciones?: PaginateRelacion[];
  private readonly sqlDialectConfig: PaginateSqlDialectConfig;
  private readonly presetFilterGroups?: PaginateFiltro[][];
  private readonly defaultPageSize: number;

  private filtros?: PaginateFiltro[][];
  private ordenes?: PaginateOrden[];

  public readonly defaultPageSizeOptions = [10, 20, 50, 100];
  public readonly items = this._items.asReadonly();
  public readonly totalCount = this._totalCount.asReadonly();
  public readonly totalPages = this._totalPages.asReadonly();
  public readonly pageIndex = this._pageIndex.asReadonly();
  public readonly pageSize = this._pageSize.asReadonly();
  public readonly hasNextPage = this._hasNextPage.asReadonly();
  public readonly hasPreviousPage = this._hasPreviousPage.asReadonly();
  public readonly firstItemIndex = this._firstItemIndex.asReadonly();
  public readonly loadState = this._loadState.asReadonly();
  public readonly globalFilter = this._globalFilter.asReadonly();
  public readonly sortActive = this._sortActive.asReadonly();
  public readonly sortDirection = this._sortDirection.asReadonly();
  public readonly filters = this._filters.asReadonly();
  public readonly loading = () => this._loadState() === LoadState.Loading;

  constructor({
    fetchData,
    globalSearchConfig,
    relaciones,
    sortConfig,
    defaultSort,
    filterConfig,
    presetFilterGroups,
    sqlDialect,
    defaultPageSize = 10,
  }: {
    fetchData: (request: PaginateQuery) => Observable<PaginationData<T>>;
    sortConfig?: MatTablePaginatorSortConfigMap;
    /**
     * Con qué orden abre el listado cuando nadie tocó un encabezado.
     *
     * **El Core no pone ninguno**: sin `ordenes` la consulta sale sin `ORDER BY` y Postgres devuelve
     * las filas en el orden que le queda cómodo —en la práctica, las más viejas primero—. Eso no es
     * una decisión, es la ausencia de una; y en un listado de hechos lo que alguien viene a mirar es
     * lo último que pasó.
     *
     * La columna tiene que estar en {@link sortConfig}: es de ahí que sale a qué tabla y a qué
     * columna real traducirla. Clickear un encabezado lo pisa, y el usuario puede volver al orden
     * que quiera.
     */
    defaultSort?: { columnKey: string; direction: 'asc' | 'desc' };
    filterConfig?: MatTablePaginatorFilterConfigMap;
    globalSearchConfig?: MatTablePaginatorGlobalSearchConfig[];
    relaciones?: PaginateRelacion[];
    /**
     * Grupos de filtro que van siempre, antes de los que pone el usuario. Son **grupos** y no un
     * filtro suelto porque se combinan con AND entre sí y con OR adentro: «lo comprable» y «lo que
     * no es un kit virtual» son dos condiciones distintas, y meterlas en un solo grupo las volvería
     * alternativas.
     */
    presetFilterGroups?: PaginateFiltro[][];
    /** Defaults to PostgreSQL (backend dialect). */
    sqlDialect?: PaginateSqlDialect | PaginateSqlDialectConfig;
    defaultPageSize?: number;
  }) {
    this.fetchData = fetchData;
    this.globalSearchConfig = globalSearchConfig;
    this.presetFilterGroups = presetFilterGroups;
    this.relaciones = relaciones;
    this.defaultPageSize = defaultPageSize;
    this._pageSize.set(defaultPageSize);
    this.sqlDialectConfig = resolvePaginateSqlDialectConfig(sqlDialect);

    if (filterConfig) {
      Object.entries(filterConfig).forEach(([columnKey, config]) => {
        this.filterConfigByColumnKey.set(columnKey, config);
      });
    }
    if (sortConfig) {
      Object.entries(sortConfig).forEach(([columnKey, config]) => {
        this.sortConfigByColumnKey.set(columnKey, config);
      });
    }

    // Se siembra el estado en vez de inyectar el `orden` al construir la consulta: así el encabezado
    // muestra la flecha del orden que de verdad está aplicado, y clickear otra columna lo reemplaza
    // por el camino normal en lugar de sumarse a él.
    if (defaultSort && this.sortConfigByColumnKey.has(defaultSort.columnKey)) {
      this._sortActive.set(defaultSort.columnKey);
      this._sortDirection.set(defaultSort.direction);
    }
  }

  /** Builds the backend `PaginateList` body from a Material paginate event. */
  public buildRequest(event: MatTablePaginateEvent): PaginateQuery {
    const pageIndex = Math.max(0, event.pageIndex);
    const pageSize = event.pageSize > 0 ? event.pageSize : this.defaultPageSize;
    const filtros: PaginateFiltro[][] = [];
    const ordenes: PaginateOrden[] = [];

    this._pageIndex.set(pageIndex);
    this._pageSize.set(pageSize);
    this._globalFilter.set(event.globalFilter?.trim() ?? '');
    this._sortActive.set(event.sortActive ?? null);
    this._sortDirection.set(event.sortDirection ?? '');
    this._filters.set(event.filters ?? {});

    if (event.sortActive && (event.sortDirection === 'asc' || event.sortDirection === 'desc')) {
      const sortConfig = this.sortConfigByColumnKey.get(event.sortActive);
      if (sortConfig) {
        ordenes.push({
          tabla: sortConfig.tabla,
          columna: sortConfig.columna,
          direccion: event.sortDirection.toUpperCase(),
        });
      }
    }

    const globalFilter = event.globalFilter?.trim();
    if (globalFilter && this.globalSearchConfig?.length) {
      const textOperation = this.sqlDialectConfig.caseInsensitiveLike;
      filtros.push(
        this.globalSearchConfig.map((config) => ({
          ...config,
          operacion: textOperation,
          valor: formatPatternFilterValor(globalFilter, FilterMatchMode.Contains),
        })),
      );
    }

    if (event.filters) {
      Object.entries(event.filters).forEach(([key, value]) => {
        const filterConfig = this.filterConfigByColumnKey.get(key);
        if (!filterConfig) {
          return;
        }

        const constraints = Array.isArray(value) ? value : [value];
        constraints.forEach((constraint) => {
          if (!this.hasFilterValue(constraint.value) && !this.isNullMatchMode(constraint.matchMode)) {
            return;
          }

          const operacion = this.getOperacionFromFilterMatchMode(constraint.matchMode);
          filtros.push([
            {
              tabla: filterConfig.tabla,
              columna: filterConfig.columna,
              operacion,
              valor: this.formatFilterValor(operacion, constraint.value, constraint.matchMode),
            },
          ]);
        });
      });
    }

    const mergedFiltros = this.mergePresetFilters(filtros);
    this.filtros = mergedFiltros.length > 0 ? mergedFiltros : undefined;
    this.ordenes = ordenes.length > 0 ? ordenes : undefined;

    return {
      page: pageIndex + 1,
      size: pageSize,
      filtros: this.filtros,
      ordenes: this.ordenes,
      relaciones: this.relaciones?.length ? this.relaciones : undefined,
    };
  }

  /** Handles `mat-paginator` `(page)` events. */
  public handlePageEvent(event: PageEvent): void {
    this.loadFromEvent({
      ...this.getCurrentEvent(),
      pageIndex: event.pageIndex,
      pageSize: event.pageSize,
    });
  }

  /** Handles `matSortChange` from `mat-sort`. */
  public handleSortChange(sort: Sort): void {
    this.loadFromEvent({
      ...this.getCurrentEvent(),
      pageIndex: 0,
      sortActive: sort.active,
      sortDirection: sort.direction,
    });
  }

  /** Updates the global search and reloads from page 0. */
  public setGlobalFilter(value: string): void {
    this.loadFromEvent({
      ...this.getCurrentEvent(),
      pageIndex: 0,
      globalFilter: value,
    });
  }

  /** Replaces column filters and reloads from page 0. */
  public setFilters(
    filters: Record<string, PaginationFilterConstraint | PaginationFilterConstraint[]>,
  ): void {
    this.loadFromEvent({
      ...this.getCurrentEvent(),
      pageIndex: 0,
      filters,
    });
  }

  /** Clears column filters (keeps search/sort/page size) and reloads from page 0. */
  public clearFilters(): void {
    this.setFilters({});
  }

  /** Full reload driven by a Material paginate event. */
  public handlePaginateEvent(event: MatTablePaginateEvent): void {
    this.loadFromEvent(event);
  }

  /** Restores state from router query params and fetches. */
  public applyQueryParams(params: Params): void {
    const event = queryParamsToPaginateEvent(params, {
      defaultPageSize: this.defaultPageSize,
    });
    this.loadFromEvent({
      ...this.getCurrentEvent(),
      ...event,
      globalFilter: event.globalFilter ?? '',
      filters: event.filters ?? {},
    });
  }

  /** Current UI state as router query params (omit defaults). */
  public toQueryParams(): Params {
    return paginateEventToQueryParams(this.getCurrentEvent(), {
      defaultPageSize: this.defaultPageSize,
    });
  }

  /** Reloads with the last built filtros/ordenes/page. */
  public refresh(): void {
    this.loadData(this.getCurrentQuery());
  }

  /** Initial fetch using current (or default) state. */
  public load(): void {
    this.loadFromEvent(this.getCurrentEvent());
  }

  /** Current pagination state as a `/paginate` body (exports, manual reload). */
  public getCurrentQuery(): PaginateQuery {
    return {
      page: this._pageIndex() + 1,
      size: this._pageSize(),
      filtros: this.filtros,
      ordenes: this.ordenes,
      relaciones: this.relaciones?.length ? this.relaciones : undefined,
    };
  }

  /** Snapshot of the current Material paginate event. */
  public getCurrentEvent(): MatTablePaginateEvent {
    return {
      pageIndex: this._pageIndex(),
      pageSize: this._pageSize(),
      sortActive: this._sortActive() ?? undefined,
      sortDirection: this._sortDirection(),
      globalFilter: this._globalFilter(),
      filters: this._filters(),
    };
  }

  public handleSuccess(data: PaginationData<T>): void {
    this._items.set(data.content ?? []);
    this._totalCount.set(data.totalElements ?? 0);
    this._totalPages.set(data.totalPages ?? 0);
    this._hasNextPage.set(!data.last);
    this._hasPreviousPage.set(!data.first);
    this._pageSize.set(data.size ?? this._pageSize());
    this._pageIndex.set(data.number ?? this._pageIndex());
    this._firstItemIndex.set((data.number ?? 0) * (data.size ?? this._pageSize()));
  }

  private loadFromEvent(event: MatTablePaginateEvent): void {
    this._loadState.set(LoadState.Loading);
    this.loadData(this.buildRequest(event));
  }

  private loadData(query: PaginateQuery): void {
    this.fetchData(query).subscribe({
      next: (data) => {
        this.handleSuccess(data);
        this._loadState.set(LoadState.Success);
      },
      error: () => {
        this._items.set([]);
        this._totalCount.set(0);
        this._loadState.set(LoadState.Error);
      },
    });
  }

  private getOperacionFromFilterMatchMode(filterMatchMode: FilterMatchMode | string): string {
    return resolveOperacionFromFilterMatchMode(filterMatchMode, this.sqlDialectConfig);
  }

  private formatFilterValor(
    operacion: string,
    value: unknown,
    matchMode: FilterMatchMode | string,
  ): string {
    if (
      matchMode === FilterMatchMode.IsNull ||
      matchMode === FilterMatchMode.IsNotNull
    ) {
      return '';
    }

    if (isPatternMatchOperation(operacion)) {
      return formatPatternFilterValor(value, matchMode);
    }

    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }

    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  }

  private hasFilterValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === 'string') {
      return value.trim().length > 0;
    }
    return true;
  }

  private isNullMatchMode(matchMode: FilterMatchMode | string): boolean {
    return matchMode === FilterMatchMode.IsNull || matchMode === FilterMatchMode.IsNotNull;
  }

  private mergePresetFilters(filtros: PaginateFiltro[][]): PaginateFiltro[][] {
    const presets = (this.presetFilterGroups ?? []).filter((grupo) => grupo.length > 0);
    if (presets.length === 0) {
      return filtros;
    }
    return [...presets.map((grupo) => [...grupo]), ...filtros];
  }
}
