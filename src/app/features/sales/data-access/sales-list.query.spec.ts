import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { OrderDto } from '../../../core/orders/order-commit.model';
import { FilterMatchMode, PaginateQuery, PaginationData } from '../../../core/paginate';
import { createSalesPaginator } from './sales-list.query';

const emptyPage: PaginationData<OrderDto> = {
  content: [],
  last: true,
  totalElements: 0,
  totalPages: 0,
  size: 10,
  number: 0,
  first: true,
  numberOfElements: 0,
  empty: true,
};

/** Arma el paginador y devuelve el body con el que llamaría al backend. */
function buildQuery(
  event: Parameters<ReturnType<typeof createSalesPaginator>['buildRequest']>[0],
): PaginateQuery {
  const paginator = createSalesPaginator(() => of(emptyPage));
  return paginator.buildRequest(event);
}

describe('createSalesPaginator', () => {
  /**
   * Lo único que separa una venta de una compra: comparten tabla, endpoint y service, y la orden no
   * tiene columna `type`. Sin este filtro el listado mostraría también las compras.
   */
  it('always constrains the query to sale vouchers', () => {
    const query = buildQuery({ pageIndex: 0, pageSize: 10 });

    expect(query.filtros?.[0]).toEqual([
      { tabla: 'vouchers', columna: 'operation_type', operacion: '=', valor: 'SALE' },
    ]);
  });

  /** El grupo de venta tiene que sobrevivir a lo que el usuario escriba o elija. */
  it('keeps the sale constraint ahead of the search and the column filters', () => {
    const query = buildQuery({
      pageIndex: 0,
      pageSize: 10,
      globalFilter: 'acme',
      filters: {
        customer: { value: 'customer-uuid', matchMode: FilterMatchMode.Equals },
      },
    });

    // Los grupos externos se combinan con AND: venta Y (búsqueda) Y (cliente).
    expect(query.filtros?.[0]?.[0]?.valor).toBe('SALE');
    expect(query.filtros?.[1]).toEqual([
      { tabla: 't', columna: 'public_id', operacion: 'ILIKE', valor: '%acme%' },
      { tabla: 't', columna: 'observations', operacion: 'ILIKE', valor: '%acme%' },
      { tabla: 'parties', columna: 'name', operacion: 'ILIKE', valor: '%acme%' },
      { tabla: 'vouchers', columna: 'name', operacion: 'ILIKE', valor: '%acme%' },
    ]);
    expect(query.filtros?.[2]).toEqual([
      { tabla: 'party_roles', columna: 'uuid', operacion: '=', valor: 'customer-uuid' },
    ]);
  });

  /**
   * El backend sólo emite el JOIN de una tabla que un filtro u orden nombre, y arma la cadena desde
   * `t`: si la dirección de una relación se invierte, la columna deja de existir en la consulta.
   */
  it('declares the joins the filters and the sorts need, all anchored on the order', () => {
    const query = buildQuery({ pageIndex: 0, pageSize: 10 });

    expect(query.relaciones).toEqual([
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
      // La FK vive en el checkout, no en la orden: la relación va de `t.id` a `id_order`.
      {
        tipo: 'left',
        desdeTabla: 't',
        desdeColumna: 'id',
        hastaTabla: 'order_checkouts',
        hastaColumna: 'id_order',
      },
    ]);
  });

  it('maps the total column onto the checkout, which is where the amount lives', () => {
    const query = buildQuery({
      pageIndex: 0,
      pageSize: 10,
      sortActive: 'total',
      sortDirection: 'desc',
    });

    expect(query.ordenes).toEqual([
      { tabla: 'order_checkouts', columna: 'total_amount', direccion: 'DESC' },
    ]);
  });

  it('sends the page 1-based, as the backend expects', () => {
    const query = buildQuery({ pageIndex: 2, pageSize: 20 });

    expect(query.page).toBe(3);
    expect(query.size).toBe(20);
  });
});
