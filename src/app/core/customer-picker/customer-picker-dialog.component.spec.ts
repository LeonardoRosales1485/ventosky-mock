import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginateQuery } from '../paginate';
import { CustomerPickerDialogComponent } from './customer-picker-dialog.component';
import { CustomerPickerDialogData, PickerCustomer } from './customer-picker.model';

const FINAL: PickerCustomer = {
  uuid: 'sin-doc-uuid',
  name: 'Cliente Sin Documento',
};

const ACME: PickerCustomer = {
  uuid: 'acme-uuid',
  name: 'Acme SA',
  docType: 'CUIT',
  docNumber: '30712345678',
  priceList: { uuid: 'wholesale-uuid', name: 'Mayorista' },
};

/** Más que el debounce del buscador, para que la consulta llegue a salir. */
const AFTER_DEBOUNCE_MS = 320;

describe('CustomerPickerDialogComponent', () => {
  let fixture: ComponentFixture<CustomerPickerDialogComponent>;
  let http: HttpTestingController;
  let close: ReturnType<typeof vi.fn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const rows = (): HTMLElement[] => [...host().querySelectorAll<HTMLElement>('tr.mat-mdc-row')];

  const type = (value: string): void => {
    const input = host().querySelector<HTMLInputElement>('input[type="text"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const settle = async (delay = 0): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  /** La única consulta al paginado de clientes que haya pendiente, ya respondida. */
  const answerPaginate = (customers: readonly PickerCustomer[]): PaginateQuery => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.CUSTOMERS.PAGINATE));
    const query = request.request.body as PaginateQuery;

    request.flush({ content: customers, totalCount: customers.length });
    fixture.detectChanges();

    return query;
  };

  const create = (data: CustomerPickerDialogData = {}): void => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerPickerDialogComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    close = vi.fn();
  });

  afterEach(() => {
    http.verify();
  });

  it('abre pidiendo la primera página ordenada por nombre', () => {
    create();

    const query = answerPaginate([FINAL, ACME]);

    expect(query.page).toBe(1);
    expect(query.ordenes).toEqual([{ tabla: 'parties', columna: 'name', direccion: 'ASC' }]);
    expect(query.filtros).toBeUndefined();
    expect(rows()).toHaveLength(2);
  });

  /** Lo que el cliente dice es su nombre o su documento: un solo campo busca por los dos. */
  it('busca por nombre y por documento con lo que se tipea', async () => {
    create();
    answerPaginate([]);

    type('3071');
    await settle(AFTER_DEBOUNCE_MS);

    const query = answerPaginate([ACME]);

    expect(query.filtros?.[0].map((filtro) => filtro.columna)).toEqual(['name', 'doc_number']);
    expect(query.filtros?.[0].every((filtro) => filtro.valor === '%3071%')).toBe(true);
    // El grupo es uno solo: sus condiciones se combinan con OR, no con AND.
    expect(query.filtros).toHaveLength(1);
  });

  it('elegir una fila cierra con el cliente entero', () => {
    create();
    answerPaginate([FINAL, ACME]);

    rows()[1].click();

    expect(close).toHaveBeenCalledWith(ACME);
  });

  /** Se marca a quién se le está por cambiar, no sólo a quién se elige. */
  it('señala el cliente que ya tenía la venta', () => {
    create({ selectedUuid: FINAL.uuid });
    answerPaginate([FINAL, ACME]);

    expect(rows()[0].getAttribute('aria-current')).toBe('true');
    expect(rows()[1].getAttribute('aria-current')).toBeNull();
  });
});
