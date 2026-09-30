import { FilterMatchMode } from './paginate-filter-match-mode';

export type PaginateSqlDialect = 'mysql' | 'postgresql';

/**
 * Maps filter match modes to legacy paginate `operacion` values.
 * MySQL has no ILIKE; utf8mb4_*_ci collations make LIKE case-insensitive in practice.
 * PostgreSQL should use ILIKE for case-insensitive text search.
 */
export interface PaginateSqlDialectConfig {
  caseInsensitiveLike: 'LIKE' | 'ILIKE';
  defaultTextOperation: 'LIKE' | 'ILIKE';
  matchModeOperations: Partial<Record<string, string>>;
}

const BASE_MATCH_MODE_OPERATIONS: Partial<Record<string, string>> = {
  [FilterMatchMode.Equals]: '=',
  [FilterMatchMode.NotEquals]: '!=',
  [FilterMatchMode.In]: 'in',
  [FilterMatchMode.DateIs]: '=',
  [FilterMatchMode.DateIsNot]: '!=',
  [FilterMatchMode.DateBefore]: '<=',
  [FilterMatchMode.DateAfter]: '>=',
  [FilterMatchMode.LessThan]: '<',
  [FilterMatchMode.LessThanOrEqualTo]: '<=',
  [FilterMatchMode.GreaterThan]: '>',
  [FilterMatchMode.GreaterThanOrEqualTo]: '>=',
  [FilterMatchMode.Between]: 'BETWEEN',
  [FilterMatchMode.IsNull]: 'is null',
  [FilterMatchMode.IsNotNull]: 'is not null',
};

function withTextSearch(
  caseInsensitiveLike: 'LIKE' | 'ILIKE',
): Partial<Record<string, string>> {
  return {
    ...BASE_MATCH_MODE_OPERATIONS,
    [FilterMatchMode.StartsWith]: caseInsensitiveLike,
    [FilterMatchMode.Contains]: caseInsensitiveLike,
    [FilterMatchMode.EndsWith]: caseInsensitiveLike,
  };
}

export const PAGINATE_SQL_DIALECTS: Record<PaginateSqlDialect, PaginateSqlDialectConfig> = {
  mysql: {
    caseInsensitiveLike: 'LIKE',
    defaultTextOperation: 'LIKE',
    matchModeOperations: withTextSearch('LIKE'),
  },
  postgresql: {
    caseInsensitiveLike: 'ILIKE',
    defaultTextOperation: 'ILIKE',
    matchModeOperations: withTextSearch('ILIKE'),
  },
};

export function resolvePaginateSqlDialectConfig(
  dialect?: PaginateSqlDialect | PaginateSqlDialectConfig,
): PaginateSqlDialectConfig {
  if (!dialect) {
    return PAGINATE_SQL_DIALECTS.postgresql;
  }

  if (typeof dialect === 'string') {
    return PAGINATE_SQL_DIALECTS[dialect];
  }

  return dialect;
}

export function isPatternMatchOperation(operacion: string): boolean {
  const op = operacion.trim().toUpperCase();
  return op === 'LIKE' || op === 'ILIKE';
}

export function formatPatternFilterValor(
  value: unknown,
  matchMode: FilterMatchMode | string,
): string {
  const str = String(value);

  if (matchMode === FilterMatchMode.StartsWith) {
    return `${str}%`;
  }

  if (matchMode === FilterMatchMode.EndsWith) {
    return `%${str}`;
  }

  return `%${str}%`;
}

/**
 * Escapa los comodines de `LIKE` / `ILIKE` (`%` y `_`) y la propia barra de escape, para poder usar
 * el operador como una igualdad que ignora mayúsculas: `ILIKE 'ABC_1'` sin escapar matchea también
 * `ABC-1`, y en una búsqueda por código eso devuelve el producto equivocado.
 *
 * El valor viaja como parámetro preparado, así que esto es sobre el patrón, no sobre el SQL.
 */
export function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function getOperacionFromFilterMatchMode(
  matchMode: FilterMatchMode | string,
  dialect: PaginateSqlDialectConfig,
): string {
  return dialect.matchModeOperations[String(matchMode)] ?? dialect.defaultTextOperation;
}
