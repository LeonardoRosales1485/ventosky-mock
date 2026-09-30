import { Params } from '@angular/router';
import { FilterMatchMode } from './paginate-filter-match-mode';
import {
  MatTablePaginateEvent,
  PaginationFilterConstraint,
} from './paginate.models';

const PAGE_KEY = 'page';
const SIZE_KEY = 'size';
const SORT_KEY = 'sort';
const SEARCH_KEY = 'q';
const FILTER_PREFIX = 'f.';

export interface PaginateQueryParamsOptions {
  /** Defaults to 10. */
  defaultPageSize?: number;
  /** Defaults to 0 (Material 0-based). */
  defaultPageIndex?: number;
}

/**
 * Serializes a Material paginate event into router query params.
 *
 * Shape:
 * - `page` — 1-based (matches backend `PaginateList.page`)
 * - `size` — page size
 * - `sort` — `columnKey:ASC|DESC` (repeatable via comma: `a:ASC,b:DESC`)
 * - `q` — global search
 * - `f.{columnKey}.{matchMode}` — filter value (arrays joined by `,`)
 */
export function paginateEventToQueryParams(
  event: MatTablePaginateEvent,
  options: PaginateQueryParamsOptions = {},
): Params {
  const defaultPageSize = options.defaultPageSize ?? 10;
  const defaultPageIndex = options.defaultPageIndex ?? 0;
  const params: Params = {};

  const page = (event.pageIndex ?? defaultPageIndex) + 1;
  if (page > 1) {
    params[PAGE_KEY] = String(page);
  }

  if (event.pageSize !== defaultPageSize) {
    params[SIZE_KEY] = String(event.pageSize);
  }

  if (event.sortActive && (event.sortDirection === 'asc' || event.sortDirection === 'desc')) {
    params[SORT_KEY] = `${event.sortActive}:${event.sortDirection.toUpperCase()}`;
  }

  const search = event.globalFilter?.trim();
  if (search) {
    params[SEARCH_KEY] = search;
  }

  if (event.filters) {
    for (const [columnKey, raw] of Object.entries(event.filters)) {
      const constraints = Array.isArray(raw) ? raw : [raw];
      for (const constraint of constraints) {
        if (!hasFilterValue(constraint.value)) {
          continue;
        }
        const key = `${FILTER_PREFIX}${columnKey}.${constraint.matchMode}`;
        params[key] = serializeFilterValue(constraint.value);
      }
    }
  }

  return params;
}

/**
 * Reconstructs a Material paginate event from router query params.
 * Missing keys fall back to defaults; unknown `f.*` keys are ignored safely.
 */
export function queryParamsToPaginateEvent(
  params: Params,
  options: PaginateQueryParamsOptions = {},
): MatTablePaginateEvent {
  const defaultPageSize = options.defaultPageSize ?? 10;
  const defaultPageIndex = options.defaultPageIndex ?? 0;

  const pageOneBased = parsePositiveInt(params[PAGE_KEY], 1);
  const pageSize = parsePositiveInt(params[SIZE_KEY], defaultPageSize);
  const pageIndex = Math.max(0, pageOneBased - 1);

  const event: MatTablePaginateEvent = {
    pageIndex: Number.isFinite(pageIndex) ? pageIndex : defaultPageIndex,
    pageSize,
  };

  const sortRaw = firstString(params[SORT_KEY]);
  if (sortRaw) {
    const [field, direction] = sortRaw.split(':');
    if (field) {
      event.sortActive = field;
      const dir = direction?.toLowerCase();
      event.sortDirection = dir === 'desc' ? 'desc' : dir === 'asc' ? 'asc' : '';
    }
  }

  const search = firstString(params[SEARCH_KEY]);
  if (search) {
    event.globalFilter = search;
  }

  const filters: Record<string, PaginationFilterConstraint[]> = {};
  for (const [key, rawValue] of Object.entries(params)) {
    if (!key.startsWith(FILTER_PREFIX)) {
      continue;
    }

    const rest = key.slice(FILTER_PREFIX.length);
    const dot = rest.lastIndexOf('.');
    if (dot <= 0) {
      continue;
    }

    const columnKey = rest.slice(0, dot);
    const matchMode = rest.slice(dot + 1);
    if (!columnKey || !matchMode) {
      continue;
    }

    const valueStr = firstString(rawValue);
    if (valueStr == null || valueStr === '') {
      continue;
    }

    const list = filters[columnKey] ?? (filters[columnKey] = []);
    list.push({
      matchMode: matchMode as FilterMatchMode,
      value: deserializeFilterValue(valueStr, matchMode),
    });
  }

  if (Object.keys(filters).length > 0) {
    event.filters = Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [k, v.length === 1 ? v[0]! : v]),
    );
  }

  return event;
}

function hasFilterValue(value: unknown): boolean {
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

function serializeFilterValue(
  value: string | string[] | number | number[] | boolean | null,
): string {
  if (Array.isArray(value)) {
    return value.map(String).join(',');
  }
  return String(value);
}

function deserializeFilterValue(
  value: string,
  matchMode: string,
): string | string[] | number | boolean {
  if (matchMode === FilterMatchMode.In || matchMode === FilterMatchMode.Between) {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }

  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  return value;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const raw = firstString(value);
  if (raw == null) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}
