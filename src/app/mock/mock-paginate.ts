import { PaginateFiltro, PaginateQuery, PaginationData } from '../core/paginate';

/**
 * Ejecuta el `PaginateQuery` del Core (`page` en base 1, `filtros` = AND de grupos OR, `ordenes`)
 * contra un array en memoria y devuelve el `Page<T>` de Spring.
 *
 * A diferencia de `in-memory-paginate.ts` no necesita accessors por recurso: resuelve cada
 * `tabla.columna` buscando el campo en la fila (tal cual, en camelCase, o dentro del objeto
 * relacionado que nombra `tabla`). Una columna que no se encuentra no filtra.
 */
export function mockPaginate<T>(rows: readonly T[], query: Partial<PaginateQuery> | null): PaginationData<T> {
  const q: PaginateQuery = { page: 1, size: 10, ...(query ?? {}) } as PaginateQuery;
  const filtered = rows.filter((row) => matchesAll(row, q.filtros));
  const sorted = sortRows(filtered, q);

  const size = q.size > 0 ? q.size : 10;
  const pageIndex = Math.max(0, (q.page ?? 1) - 1);
  const totalElements = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalElements / size));
  const content = sorted.slice(pageIndex * size, pageIndex * size + size);

  return {
    content,
    totalElements,
    totalPages,
    size,
    number: pageIndex,
    numberOfElements: content.length,
    first: pageIndex === 0,
    last: pageIndex >= totalPages - 1,
    empty: content.length === 0,
  };
}

const MISSING = Symbol('missing');

function camel(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Busca `columna` en la fila, primero dentro del objeto que nombra `tabla`. */
export function resolveColumn(row: unknown, columna: string, tabla?: string): unknown {
  if (row === null || typeof row !== 'object') {
    return MISSING;
  }
  const record = row as Record<string, unknown>;
  const col = camel(columna);
  const candidates = [columna, col];
  if (col.endsWith('Uuid')) {
    candidates.push(col.slice(0, -4));
  }

  if (tabla && tabla !== 't') {
    const tableKey = camel(tabla.replace(/s$/, ''));
    for (const key of [camel(tabla), tableKey]) {
      const nested = record[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const inner = resolveColumn(nested, columna);
        if (inner !== MISSING) {
          return inner;
        }
      }
    }
  }

  for (const key of candidates) {
    if (key in record) {
      const value = record[key];
      // `brandUuid` contra `brand: {uuid}`.
      if (value && typeof value === 'object' && !Array.isArray(value) && 'uuid' in value && col.endsWith('Uuid')) {
        return (value as { uuid: unknown }).uuid;
      }
      return value;
    }
  }

  if (tabla && tabla !== 't') {
    return MISSING;
  }

  // Un nivel hacia adentro: `accountUuid` puede vivir en `account.uuid`.
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      if (col in nested) {
        return nested[col];
      }
    }
  }
  return MISSING;
}

function matchesAll(row: unknown, groups: readonly PaginateFiltro[][] | undefined): boolean {
  if (!groups?.length) {
    return true;
  }
  return groups.every((group) => !group.length || group.some((filtro) => matches(row, filtro)));
}

function matches(row: unknown, filtro: PaginateFiltro): boolean {
  const raw = resolveColumn(row, filtro.columna, filtro.tabla);
  if (raw === MISSING) {
    return true;
  }
  const operacion = String(filtro.operacion ?? '=').trim().toUpperCase();
  const valor = filtro.valor ?? '';

  if (Array.isArray(raw)) {
    return raw.some((item) =>
      matches({ v: item && typeof item === 'object' && 'uuid' in item ? item.uuid : item }, {
        ...filtro,
        tabla: 't',
        columna: 'v',
      }),
    );
  }

  switch (operacion) {
    case 'IS NULL':
      return raw === null || raw === undefined;
    case 'IS NOT NULL':
      return raw !== null && raw !== undefined;
    case 'LIKE':
    case 'ILIKE':
      return matchesPattern(raw, valor);
    case 'NOT LIKE':
    case 'NOT ILIKE':
      return !matchesPattern(raw, valor);
    case 'IN':
      return parseList(valor).some((item) => looseEquals(raw, item));
    case 'NOT IN':
      return !parseList(valor).some((item) => looseEquals(raw, item));
    case '=':
      return looseEquals(raw, parseScalar(valor));
    case '!=':
    case '<>':
      return !looseEquals(raw, parseScalar(valor));
    case 'BETWEEN': {
      const [from, to] = parseList(valor);
      return compare(raw, from, '>=') && compare(raw, to, '<=');
    }
    default:
      return compare(raw, parseScalar(valor), operacion);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesPattern(raw: unknown, valor: string): boolean {
  if (raw === null || raw === undefined) {
    return false;
  }
  let regex = '';
  for (let index = 0; index < valor.length; index += 1) {
    const char = valor[index];
    if (char === '\\') {
      index += 1;
      regex += escapeRegExp(valor[index] ?? '');
    } else if (char === '%') {
      regex += '.*';
    } else if (char === '_') {
      regex += '.';
    } else {
      regex += escapeRegExp(char);
    }
  }
  const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
  return new RegExp(`^${normalize(regex)}$`, 'iu').test(normalize(String(raw)));
}

function compare(raw: unknown, value: unknown, operacion: string): boolean {
  if (raw === null || raw === undefined || value === null || value === undefined) {
    return false;
  }
  const left = typeof raw === 'number' ? raw : String(raw);
  const right = typeof raw === 'number' ? Number(value) : String(value);
  switch (operacion) {
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      return true;
  }
}

function looseEquals(raw: unknown, value: unknown): boolean {
  if (raw === null || raw === undefined) {
    return value === null || value === undefined || value === 'null';
  }
  if (typeof raw === 'object' && 'uuid' in (raw as object)) {
    return looseEquals((raw as { uuid: unknown }).uuid, value);
  }
  if (typeof raw === 'number') {
    return raw === Number(value);
  }
  if (typeof raw === 'boolean') {
    return raw === (value === true || value === 'true' || value === 1 || value === '1');
  }
  return String(raw).toLowerCase() === String(value).toLowerCase();
}

function parseScalar(valor: unknown): unknown {
  if (typeof valor !== 'string') {
    return valor;
  }
  try {
    return JSON.parse(valor) as unknown;
  } catch {
    return valor;
  }
}

function parseList(valor: unknown): unknown[] {
  const parsed = parseScalar(valor);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (typeof parsed === 'string' && parsed.includes(',')) {
    return parsed.split(',').map((item) => item.trim().replace(/^'|'$/g, ''));
  }
  return [parsed];
}

function sortRows<T>(rows: readonly T[], query: PaginateQuery): T[] {
  const ordenes = query.ordenes ?? [];
  if (!ordenes.length) {
    return [...rows];
  }
  return [...rows].sort((a, b) => {
    for (const orden of ordenes) {
      const left = resolveColumn(a, orden.columna, orden.tabla);
      const right = resolveColumn(b, orden.columna, orden.tabla);
      if (left === MISSING || right === MISSING || left === right) {
        continue;
      }
      if (left === null || left === undefined) {
        return 1;
      }
      if (right === null || right === undefined) {
        return -1;
      }
      const direction = String(orden.direccion).toUpperCase() === 'DESC' ? -1 : 1;
      const cmp =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'es', { numeric: true, sensitivity: 'base' });
      if (cmp !== 0) {
        return cmp * direction;
      }
    }
    return 0;
  });
}
