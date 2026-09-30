import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../auth/auth.service';
import { Permissions } from '../../auth/permissions';
import { API_ENDPOINTS, apiUrl } from '../../http/api.config';
import { OrderDto, OrderItemDto, OrderPromotionDto } from '../order-commit.model';
import { OrderDetailDialogComponent, OrderDetailDialogData } from './order-detail-dialog.component';

const ORDER_UUID = 'order-1';

/** La fila del paginado: encabezado completo, sin líneas — es lo que el listado tiene en la mano. */
const ROW: OrderDto = {
  uuid: ORDER_UUID,
  publicId: '0001-00000042',
  dateOperation: '2026-03-04T11:30:00.000',
  partyRole: { uuid: 'party-1', name: 'Distribuidora Sur', role: 'SUPPLIER' },
  voucher: { uuid: 'v-1', name: 'Factura A' },
  branch: { uuid: 'b-1', name: 'Casa central' },
  orderCheckout: { totalAmount: 15000 },
};

function line(fields: Partial<OrderItemDto>): OrderItemDto {
  return {
    uuid: 'item-1',
    product: { uuid: 'prod-1', name: 'Tornillo 3mm' },
    quantity: 10,
    unitPrice: 100,
    subtotal: 1000,
    ...fields,
  };
}

/**
 * El detalle del comprobante: la única pantalla que muestra las líneas de una operación cerrada.
 *
 * Lo que se verifica acá es el **indicador por línea**: que aparezca en el producto que salió del
 * catálogo, que distinga archivado de discontinuado, que **no** aparezca en el que sigue en
 * circulación, y que lleve a la ficha sólo cuando quien mira puede abrirla.
 */
describe('OrderDetailDialogComponent', () => {
  let fixture: ComponentFixture<OrderDetailDialogComponent>;
  let http: HttpTestingController;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const create = (
    data: OrderDetailDialogData = { order: ROW, kind: 'purchase' },
    canOpenProduct = true,
  ): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OrderDetailDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        {
          provide: AuthService,
          useValue: {
            hasPermission: (permission: string) =>
              permission === Permissions.productBranchAssign ? canOpenProduct : true,
          },
        },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(OrderDetailDialogComponent);
    fixture.detectChanges();
  };

  const answer = (items: OrderItemDto[], promotions: OrderPromotionDto[] = []): void => {
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.ORDERS.BY_UUID}/${ORDER_UUID}`))
      .flush({ ...ROW, items, promotions });
    fixture.detectChanges();
  };

  const chips = (): HTMLElement[] => Array.from(host().querySelectorAll('[data-chip]'));

  const promotionSection = (): HTMLElement | null => host().querySelector('.detail__promotions');

  const promotionRows = (): HTMLElement[] =>
    Array.from(host().querySelectorAll('.detail__promotions tbody tr'));

  afterEach(() => {
    http.verify();
  });

  it('el encabezado se dibuja antes de que lleguen las lineas', () => {
    create();

    // Son los mismos datos que el usuario venía mirando en la grilla: esperarlos dejaría el diálogo
    // en blanco y lo haría dudar de si abrió la fila que quería.
    expect(host().textContent).toContain('0001-00000042');
    expect(host().textContent).toContain('Distribuidora Sur');

    answer([]);
  });

  it('marca el producto archivado', () => {
    create();
    answer([line({ productState: 'ARCHIVED' })]);

    expect(chips().map((chip) => chip.dataset['chip'])).toEqual(['archived']);
  });

  it('marca el discontinuado con un chip distinto del archivado', () => {
    // Discontinuar se deshace y archivar no (ADR 0001): un solo chip para los dos borraría justo la
    // diferencia que quien lee el comprobante necesita.
    create();
    answer([
      line({ uuid: 'item-1', productState: 'ARCHIVED' }),
      line({ uuid: 'item-2', productState: 'DISCONTINUED' }),
    ]);

    expect(chips().map((chip) => chip.dataset['chip'])).toEqual(['archived', 'discontinued']);
  });

  it('el producto que sigue en circulacion no lleva marca', () => {
    // El que se dejó de comprar pero se sigue vendiendo es un activo en liquidación: el backend
    // omite el campo, y marcarlo mandaría a revisar el catálogo a quien no tiene nada que revisar.
    create();
    answer([line({}), line({ uuid: 'item-2', productState: null })]);

    expect(chips()).toHaveLength(0);
  });

  it('el indicador lleva a la ficha del producto', () => {
    // Un indicador que no se puede seguir es peor que no tener indicador.
    create();
    answer([line({ productState: 'ARCHIVED' })]);

    const link = host().querySelector<HTMLAnchorElement>('a[data-chip]');
    expect(link?.getAttribute('href')).toBe('/panel/products/prod-1/edit');
    // Leído fuera de la fila, «Archivado» no dice adónde lleva ni de qué producto habla.
    expect(link?.getAttribute('aria-label')).toBeTruthy();
  });

  it('sin permiso sobre el catalogo el indicador informa pero no enlaza', () => {
    // El enlace terminaría en la pantalla de «sin permiso»: el área entera exige
    // `product.branch_assign`. El cajero conserva la marca, que es lo que necesita para leer la
    // línea.
    create({ order: ROW, kind: 'sale' }, false);
    answer([line({ productState: 'ARCHIVED' })]);

    expect(chips()).toHaveLength(1);
    expect(host().querySelector('a[data-chip]')).toBeNull();
  });

  it('el detalle no pisa lo que el encabezado ya mostraba', () => {
    // El detalle es autoritativo donde habla, pero un campo que no repite no puede **borrar** el que
    // el usuario ya está leyendo: se funde sobre la fila del listado, no la reemplaza.
    create();
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.ORDERS.BY_UUID}/${ORDER_UUID}`))
      .flush({ uuid: ORDER_UUID, items: [line({})] });
    fixture.detectChanges();

    expect(host().textContent).toContain('Factura A');
    expect(host().textContent).toContain('Casa central');
    expect(host().textContent).toContain('Tornillo 3mm');
  });

  it('un estado que esta version no conoce no inventa un chip', () => {
    create();
    answer([line({ productState: 'SUSPENDED' })]);

    expect(chips()).toHaveLength(0);
  });

  it('la venta muestra que promociones se aplicaron, sobre que linea y por cuanto', () => {
    // Es la pantalla de la que el operador saca los importes para la nota de crédito: si la sección
    // se recorta, una devolución de una venta con promociones se queda sin fuente.
    create({ order: ROW, kind: 'sale' });
    answer(
      [line({ uuid: 'item-1', product: { uuid: 'p-1', name: 'Alfajor Jorgito' } })],
      [
        {
          uuid: 'row-1',
          promotion: { uuid: 'promo-1', name: 'Alfajores 3x2 de marzo' },
          orderItemUuid: 'item-1',
          promotionType: 'NXM',
          promotionDetail: '3x2',
          bonusQuantity: 1,
          amount: 250,
        },
      ],
    );

    expect(promotionRows()).toHaveLength(1);
    // El nombre y el detalle son los del snapshot, no los de la promoción viva.
    expect(promotionSection()?.textContent).toContain('Alfajores 3x2 de marzo');
    expect(promotionSection()?.textContent).toContain('3x2');
    expect(promotionSection()?.textContent).toContain('Alfajor Jorgito');
  });

  it('la venta sin promociones no dibuja la seccion', () => {
    // Una sección vacía llena la pantalla de encabezados que no dicen nada.
    create({ order: ROW, kind: 'sale' });
    answer([line({})]);

    expect(promotionSection()).toBeNull();
  });

  it('la compra no dibuja la seccion', () => {
    // No lleva promociones: el backend no le escribe ninguna, así que el desglose llega vacío.
    create({ order: ROW, kind: 'purchase' });
    answer([line({})]);

    expect(promotionSection()).toBeNull();
  });

  it('si el detalle falla lo dice y deja reintentar', () => {
    create();
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.ORDERS.BY_UUID}/${ORDER_UUID}`))
      .flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(host().querySelector('[role="alert"]')).not.toBeNull();

    const retry = host().querySelector<HTMLButtonElement>('[role="alert"] button');
    retry?.click();
    fixture.detectChanges();

    answer([line({})]);
    expect(host().textContent).toContain('Tornillo 3mm');
  });
});
