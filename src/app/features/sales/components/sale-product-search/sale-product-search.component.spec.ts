import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { API_ERROR_CODES } from '../../../../core/http/api-error.model';
import { PaginateQuery } from '../../../../core/paginate';
import { SaleProductDto } from '../../data-access/sale.model';
import { SalesCatalogApiService } from '../../data-access/sales-catalog-api.service';
import { ProductScanned, SaleProductSearchComponent } from './sale-product-search.component';

const COLA: SaleProductDto = {
  uuid: 'cola-uuid',
  name: 'Gaseosa Cola 1.5L',
  sku: 'GAS-COLA-15',
  barcode: '7791234567890',
  totalStock: 12,
};

const NOTEBOOK: SaleProductDto = {
  uuid: 'notebook-uuid',
  name: 'Notebook Aureo 14"',
  sku: 'NB-AUREO-14',
  stockTracking: 'SERIAL',
  totalStock: 3,
};

/** Más que el debounce del autocompletado, para que la consulta llegue a salir. */
const AFTER_DEBOUNCE_MS = 320;

describe('SaleProductSearchComponent', () => {
  let fixture: ComponentFixture<SaleProductSearchComponent>;
  let http: HttpTestingController;
  let scanned: ProductScanned[];

  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input');

  /** Como quien tipea: con el foco en el campo, que es lo que el panel de coincidencias exige para abrir. */
  const type = (value: string): void => {
    const element = input();
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const press = (key: string): void => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    fixture.detectChanges();
  };

  const settle = async (delay = 0): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  /** La resolución por código de barras, respondida con un producto o con el 404 que la descarta. */
  const answerBarcode = (product: SaleProductDto | null): void => {
    const request = http.expectOne((candidate) =>
      candidate.url === apiUrl(API_ENDPOINTS.PRODUCTS.BY_BARCODE),
    );

    if (product) {
      request.flush({ barcode: product.barcode ?? '', factor: 1, product });
    } else {
      request.flush(
        { errorCode: API_ERROR_CODES.PRODUCT_NOT_FOUND },
        { status: 404, statusText: 'Not Found' },
      );
    }

    fixture.detectChanges();
  };

  /** La única consulta al paginado de productos que haya pendiente, ya respondida. */
  const answerPaginate = (products: readonly SaleProductDto[]): PaginateQuery => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE));
    const query = request.request.body as PaginateQuery;

    request.flush({ content: products });
    fixture.detectChanges();

    return query;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService(),
        SalesCatalogApiService,
      ],
    });

    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(SaleProductSearchComponent);
    scanned = [];
    fixture.componentInstance.productSelected.subscribe((product) => scanned.push(product));
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  describe('el Enter resuelve lo escrito como lectura', () => {
    it('un código de barras carga el producto sin que nadie elija', () => {
      type('7791234567890');
      press('Enter');

      answerBarcode(COLA);

      expect(scanned.map((row) => row.product)).toEqual([COLA]);
      expect(scanned[0].serial).toBeNull();
      expect(input().value).toBe('');
    });

    it('el SKU es el segundo intento: el paginado por código exacto', () => {
      type('GAS-COLA-15');
      press('Enter');

      answerBarcode(null);

      const query = answerPaginate([COLA]);
      expect(query.filtros?.[0].map((filtro) => filtro.columna)).toEqual(['barcode', 'sku']);
      expect(query.filtros?.[0][0].valor).toBe('GAS-COLA-15');

      expect(scanned.map((row) => row.product)).toEqual([COLA]);
    });

    /**
     * El caso que antes obligaba a cambiar de modo: la etiqueta de una unidad identificada. Resuelve
     * la unidad, trae el producto y la línea entra con la serie ya elegida.
     */
    it('un número de serie carga la unidad con su serie puesta', () => {
      type('SN-A14-0042');
      press('Enter');

      answerBarcode(null);
      answerPaginate([]);

      http.expectOne(apiUrl(API_ENDPOINTS.STOCK.SERIAL_LOOKUP('SN-A14-0042'))).flush({
        uuid: 'unit-uuid',
        serialNumber: 'SN-A14-0042',
        state: 'IN_STOCK',
        product: { uuid: NOTEBOOK.uuid, name: NOTEBOOK.name },
      });
      fixture.detectChanges();

      http
        .expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${NOTEBOOK.uuid}`))
        .flush(NOTEBOOK);
      fixture.detectChanges();

      expect(scanned.map((row) => row.product)).toEqual([NOTEBOOK]);
      expect(scanned[0].serial).toBe('SN-A14-0042');
    });

    /** Una unidad que ya se vendió existe, y decirlo es distinto de decir «no existe». */
    it('una serie que no está en el mostrador no carga nada', () => {
      type('SN-A14-0042');
      press('Enter');

      answerBarcode(null);
      answerPaginate([]);

      http.expectOne(apiUrl(API_ENDPOINTS.STOCK.SERIAL_LOOKUP('SN-A14-0042'))).flush({
        uuid: 'unit-uuid',
        serialNumber: 'SN-A14-0042',
        state: 'SOLD',
        product: { uuid: NOTEBOOK.uuid, name: NOTEBOOK.name },
      });
      fixture.detectChanges();

      expect(scanned).toEqual([]);
    });
  });

  describe('mientras se tipea, sin cambiar de modo', () => {
    it('ofrece coincidencias por nombre, SKU o código de barras', async () => {
      type('gaseosa');
      await settle(AFTER_DEBOUNCE_MS);

      const query = answerPaginate([COLA]);
      expect(query.filtros?.[0].map((filtro) => filtro.columna)).toEqual([
        'name',
        'sku',
        'barcode',
      ]);
      expect(query.filtros?.[0][0].valor).toBe('%gaseosa%');
      // El segundo grupo acota a lo vendible: la lista no ofrece lo que después se rechazaría.
      expect(query.filtros?.[1].map((filtro) => filtro.columna)).toEqual([
        'is_for_sale',
        'is_for_sale',
      ]);
    });

    it('el producto entra al carrito al elegirlo de la lista', async () => {
      type('gaseosa');
      await settle(AFTER_DEBOUNCE_MS);
      answerPaginate([COLA]);
      await settle();

      const option = document.querySelector<HTMLElement>('mat-option');
      expect(option?.textContent).toContain(COLA.name);

      option?.click();
      fixture.detectChanges();

      expect(scanned.map((row) => row.product)).toEqual([COLA]);
      expect(input().value).toBe('');
    });

    /**
     * La razón por la que el panel no preselecciona nada: con una opción marcada de oficio, el Enter
     * del lector cargaría la coincidencia parcial en vez del producto que se escaneó.
     */
    it('con la lista abierta y nada marcado, el Enter sigue siendo una lectura', async () => {
      type('GAS');
      await settle(AFTER_DEBOUNCE_MS);
      answerPaginate([COLA]);
      await settle();

      press('Enter');

      answerBarcode(COLA);
      expect(scanned.map((row) => row.product)).toEqual([COLA]);
    });
  });
});
