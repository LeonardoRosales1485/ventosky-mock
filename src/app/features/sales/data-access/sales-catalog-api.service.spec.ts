import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { SalesCatalogApiService } from './sales-catalog-api.service';

describe('SalesCatalogApiService', () => {
  let http: HttpTestingController;
  let api: SalesCatalogApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SalesCatalogApiService],
    });

    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(SalesCatalogApiService);
  });

  afterEach(() => {
    http.verify();
  });

  describe('getCustomers', () => {
    /**
     * El paginado de clientes corre sobre `party_roles` y el nombre vive en `parties` desde la
     * unificación de terceros: pedir `t.name` es un `400` del generador SQL, no un orden distinto,
     * y con él el mostrador arranca sin poder resolver el consumidor final.
     */
    it('orders by the name of the identity, which is where it lives', () => {
      api.getCustomers().subscribe();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.CUSTOMERS.PAGINATE));
      expect(request.request.body.ordenes).toEqual([
        { tabla: 'parties', columna: 'name', direccion: 'ASC' },
      ]);

      request.flush({ content: [] });
    });
  });

  /** Los catálogos que no son terceros siguen ordenando por su propia tabla. */
  describe('getVouchers', () => {
    it('orders by its own name column', () => {
      api.getVouchers().subscribe();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.VOUCHERS.PAGINATE));
      expect(request.request.body.ordenes).toEqual([
        { tabla: 't', columna: 'name', direccion: 'ASC' },
      ]);

      request.flush({ content: [] });
    });
  });
});
