import {
  PaginateFiltro,
  PaginateQuery,
  PaginationData,
} from '../../../core/paginate';

/**
 * Ejecuta un `PaginateQuery` —el mismo body que arma `MatTablePaginator` para `POST /{recurso}/paginate`—
 * contra un array en memoria, y devuelve el `Page<T>` de Spring que la tabla espera de vuelta.
 *
 * Existe para que el mock del módulo no obligue a las pantallas a hablarle distinto que al backend:
 * el listado usa `MatTablePaginator` tal cual, con su búsqueda global, su orden y sus filtros, y el
 * día que estos endpoints existan de verdad lo único que cambia es de dónde sale la respuesta.
 *
 * Interpreta lo que el paginador genera y nada más: los `filtros` son un AND de grupos OR, las
 * `operaciones` son las que mapea `paginate-sql-dialect`, y `page` viene en base 1.
 */
export function paginateInMemory<T>(
  rows: readonly T[],
  query: PaginateQuery,
  accessors: Record<string, (row: T) => unknown>,
): PaginationData<T> {
  const filtered = rows.filter((row) => matchesAll(row, query.filtros, accessors));
  const sorted = sortRows(filtered, query, accessors);

  const size = query.size > 0 ? query.size : 10;
  const pageIndex = Math.max(0, (query.page ?? 1) - 1);
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

function matchesAll<T>(
  row: T,
  groups: readonly PaginateFiltro[][] | undefined,
  accessors: Record<string, (row: T) => unknown>,
): boolean {
  if (!groups?.length) {
    return true;
  }
  return groups.every((group) => group.some((filtro) => matches(row, filtro, accessors)));
}

function matches<T>(
  row: T,
  filtro: PaginateFiltro,
  accessors: Record<string, (row: T) => unknown>,
): boolean {
  const accessor = accessors[filtro.columna];
  // Una columna que el mock no conoce no puede filtrar de más: se ignora, igual que un JOIN que el
  // backend no arma.
  if (!accessor) {
    return true;
  }

  const raw = accessor(row);
  const operacion = filtro.operacion.trim().toUpperCase();

  if (operacion === 'IS NULL') {
    return raw === null || raw === undefined;
  }
  if (operacion === 'IS NOT NULL') {
    return raw !== null && raw !== undefined;
  }
  if (operacion === 'LIKE' || operacion === 'ILIKE') {
    return matchesPattern(raw, filtro.valor);
  }
  if (operacion === 'IN') {
    return parseList(filtro.valor).some((item) => looseEquals(raw, item));
  }
  if (operacion === '=') {
    return looseEquals(raw, parseScalar(filtro.valor));
  }
  if (operacion === '!=') {
    return !looseEquals(raw, parseScalar(filtro.valor));
  }

  return compare(raw, parseScalar(filtro.valor), operacion);
}

/**
 * `%foo%` / `foo%` / `%foo` con `%` y `_` escapados por `escapeLikeWildcards`. Se traduce a una
 * expresión regular sin distinción de mayúsculas: el dialecto de la app es PostgreSQL, donde la
 * búsqueda global viaja como `ILIKE`.
 */
function matchesPattern(raw: unknown, valor: string): boolean {
  if (raw === null || raw === undefined) {
    return false;
  }

  const source = String(raw);
  let regex = '';
  for (let index = 0; index < valor.length; index += 1) {
    const char = valor[index];
    if (char === '\\') {
      index += 1;
      regex += escapeRegExp(valor[index] ?? '');
      continue;
    }
    if (char === '%') {
      regex += '.*';
      continue;
    }
    if (char === '_') {
      regex += '.';
      continue;
    }
    regex += escapeRegExp(char);
  }

  return new RegExp(`^${regex}$`, 'iu').test(source);
}

function compare(raw: unknown, value: unknown, operacion: string): boolean {
  if (raw === null || raw === undefined) {
    return false;
  }

  const left = typeof raw === 'number' ? raw : String(raw);
  const right = typeof raw === 'number' ? Number(value) : String(value);

  if (operacion === '>') {
    return left > right;
  }
  if (operacion === '>=') {
    return left >= right;
  }
  if (operacion === '<') {
    return left < right;
  }
  if (operacion === '<=') {
    return left <= right;
  }
  return true;
}

function looseEquals(raw: unknown, value: unknown): boolean {
  if (raw === null || raw === undefined) {
    return value === null || value === undefined;
  }
  if (typeof raw === 'number') {
    return raw === Number(value);
  }
  if (typeof raw === 'boolean') {
    return raw === (value === true || value === 'true');
  }
  return String(raw).toLowerCase() === String(value).toLowerCase();
}

/** El paginador manda los no-string como JSON, así que un `"5"` y un `5` llegan indistinguibles. */
function parseScalar(valor: string): unknown {
  try {
    return JSON.parse(valor) as unknown;
  } catch {
    return valor;
  }
}

function parseList(valor: string): unknown[] {
  const parsed = parseScalar(valor);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function sortRows<T>(
  rows: readonly T[],
  query: PaginateQuery,
  accessors: Record<string, (row: T) => unknown>,
): T[] {
  const orden = query.ordenes?.[0];
  const accessor = orden ? accessors[orden.columna] : undefined;
  if (!orden || !accessor) {
    return [...rows];
  }

  const direction = orden.direccion.toUpperCase() === 'DESC' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const left = accessor(a);
    const right = accessor(b);

    if (left === right) {
      return 0;
    }
    // Los nulos van siempre al final, se ordene ascendente o descendente: en un listado, una fila
    // sin dato no es "la más chica", es la que no tiene ese dato.
    if (left === null || left === undefined) {
      return 1;
    }
    if (right === null || right === undefined) {
      return -1;
    }

    if (typeof left === 'number' && typeof right === 'number') {
      return (left - right) * direction;
    }

    return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
