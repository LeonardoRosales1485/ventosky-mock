import { describe, expect, it } from 'vitest';
import { paginateInMemory } from './in-memory-paginate';

interface Row {
  name: string;
  role: 'CUSTOMER' | 'SUPPLIER';
  balance: number;
  overdue: boolean;
  lastMovement: string | null;
}

const ROWS: Row[] = [
  { name: 'Distribuidora Sur S.A.', role: 'CUSTOMER', balance: 1_245_600, overdue: true, lastMovement: '2026-08-20' },
  { name: 'Almacén La Esquina', role: 'CUSTOMER', balance: 202_650, overdue: false, lastMovement: '2026-08-18' },
  { name: 'Bebidas del Litoral S.A.', role: 'SUPPLIER', balance: 418_500, overdue: false, lastMovement: null },
  { name: 'Papelera Rioplatense', role: 'SUPPLIER', balance: 74_300, overdue: true, lastMovement: '2026-07-16' },
];

const ACCESSORS = {
  name: (row: Row) => row.name,
  role: (row: Row) => row.role,
  balance: (row: Row) => row.balance,
  overdue: (row: Row) => row.overdue,
  lastMovement: (row: Row) => row.lastMovement,
};

const names = (rows: readonly Row[]) => rows.map((row) => row.name);

describe('paginateInMemory', () => {
  it('returns the Spring page shape the table reads back', () => {
    const page = paginateInMemory(ROWS, { page: 2, size: 3 }, ACCESSORS);

    expect(page.content).toHaveLength(1);
    expect(page.totalElements).toBe(4);
    expect(page.totalPages).toBe(2);
    expect(page.number).toBe(1);
    expect(page.first).toBe(false);
    expect(page.last).toBe(true);
  });

  /** Es la forma en que viaja la búsqueda global: un grupo OR con `ILIKE '%texto%'` por columna. */
  it('matches ILIKE patterns without case sensitivity', () => {
    const page = paginateInMemory(
      ROWS,
      {
        page: 1,
        size: 10,
        filtros: [[{ tabla: 't', columna: 'name', operacion: 'ILIKE', valor: '%sur%' }]],
      },
      ACCESSORS,
    );

    expect(names(page.content)).toEqual(['Distribuidora Sur S.A.']);
  });

  it('honours the escape that turns ILIKE into a case-insensitive equality', () => {
    const page = paginateInMemory(
      ROWS,
      {
        page: 1,
        size: 10,
        filtros: [[{ tabla: 't', columna: 'name', operacion: 'ILIKE', valor: 'Papelera Rioplat\\_nse' }]],
      },
      ACCESSORS,
    );

    expect(page.content).toHaveLength(0);
  });

  it('ANDs the outer groups and ORs the inner ones', () => {
    const page = paginateInMemory(
      ROWS,
      {
        page: 1,
        size: 10,
        filtros: [
          [
            { tabla: 't', columna: 'name', operacion: 'ILIKE', valor: '%s.a.%' },
            { tabla: 't', columna: 'name', operacion: 'ILIKE', valor: '%papelera%' },
          ],
          [{ tabla: 't', columna: 'role', operacion: '=', valor: 'SUPPLIER' }],
        ],
      },
      ACCESSORS,
    );

    expect(names(page.content)).toEqual(['Bebidas del Litoral S.A.', 'Papelera Rioplatense']);
  });

  /** Los no-string viajan como JSON, así que un booleano llega `"true"` y tiene que matchear igual. */
  it('compares booleans and numbers that travelled as JSON', () => {
    const overdue = paginateInMemory(
      ROWS,
      {
        page: 1,
        size: 10,
        filtros: [[{ tabla: 't', columna: 'overdue', operacion: '=', valor: 'true' }]],
      },
      ACCESSORS,
    );
    expect(names(overdue.content)).toEqual(['Distribuidora Sur S.A.', 'Papelera Rioplatense']);

    const big = paginateInMemory(
      ROWS,
      {
        page: 1,
        size: 10,
        filtros: [[{ tabla: 't', columna: 'balance', operacion: '>=', valor: '400000' }]],
      },
      ACCESSORS,
    );
    expect(names(big.content)).toEqual(['Distribuidora Sur S.A.', 'Bebidas del Litoral S.A.']);
  });

  it('sorts numerically and pushes nulls last in both directions', () => {
    const asc = paginateInMemory(
      ROWS,
      { page: 1, size: 10, ordenes: [{ tabla: 't', columna: 'balance', direccion: 'ASC' }] },
      ACCESSORS,
    );
    expect(asc.content.map((row) => row.balance)).toEqual([74_300, 202_650, 418_500, 1_245_600]);

    const desc = paginateInMemory(
      ROWS,
      { page: 1, size: 10, ordenes: [{ tabla: 't', columna: 'lastMovement', direccion: 'DESC' }] },
      ACCESSORS,
    );
    expect(names(desc.content).at(-1)).toBe('Bebidas del Litoral S.A.');
  });

  /** Un filtro sobre una columna que el mock no proyecta no puede recortar el listado. */
  it('ignores filters on unknown columns instead of emptying the page', () => {
    const page = paginateInMemory(
      ROWS,
      {
        page: 1,
        size: 10,
        filtros: [[{ tabla: 't', columna: 'unknown', operacion: '=', valor: 'x' }]],
      },
      ACCESSORS,
    );

    expect(page.totalElements).toBe(4);
  });
});
