import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery } from '../../../core/paginate';
import { PurchasesCatalogApiService } from './purchases-catalog-api.service';

describe('PurchasesCatalogApiService', () => {
  let http: HttpTestingController;
  let api: PurchasesCatalogApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PurchasesCatalogApiService],
    });

    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(PurchasesCatalogApiService);
  });

  afterEach(() => {
    http.verify();
  });

  /** El cuerpo del `POST /product/paginate` que salió, ya tipado. */
  const searchBody = (term: string, supplierUuid?: string | null): PaginateQuery => {
    api.searchPurchasableProducts(term, supplierUuid).subscribe();
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE));
    request.flush({ content: [] });

    return request.request.body as PaginateQuery;
  };

  describe('searchPurchasableProducts', () => {
    /**
     * Sin proveedor el cuerpo es el de siempre: los JOIN no se declaran porque ningún filtro nombra
     * esas tablas, y declararlos igual sería pedirle al backend un JOIN que no va a usar.
     */
    it('asks for the purchasable half of the catalogue and nothing else', () => {
      const body = searchBody('valv');

      expect(body.relaciones).toBeUndefined();
      expect(body.filtros).toHaveLength(3);
      expect(body.filtros?.[0].map((filtro) => filtro.columna)).toEqual([
        'name',
        'sku',
        'barcode',
      ]);
      expect(body.filtros?.[1][0].columna).toBe('is_for_purchase');
    });

    /**
     * Ningún kit llega a ofrecerse: el commit los rechaza con `KIT_NOT_PURCHASABLE`, así que la
     * opción sólo serviría para provocar el error al final de la carga.
     */
    it('leaves the kits out of the suggestions', () => {
      expect(searchBody('combo').filtros?.[2]).toEqual([
        { tabla: 't', columna: 'type', operacion: '!=', valor: 'KIT' },
      ]);
    });

    it('adds the join chain and the supplier groups when the filter is on', () => {
      const body = searchBody('valv', 'supplier-uuid');

      expect(body.relaciones?.map((relacion) => relacion.hastaTabla)).toEqual([
        'product_suppliers',
        'party_roles',
      ]);
      // (nombre O sku O código) Y comprable Y no-kit-virtual Y del proveedor Y con el vínculo activo.
      expect(body.filtros).toHaveLength(5);
      expect(body.filtros?.[3][0]).toEqual({
        tabla: 'party_roles',
        columna: 'uuid',
        operacion: '=',
        valor: 'supplier-uuid',
      });
      expect(body.filtros?.[4][0].tabla).toBe('product_suppliers');
    });

    /** Apagar el filtro es dejar de mandar el proveedor: la búsqueda vuelve al catálogo entero. */
    it('drops the supplier filter when no supplier is passed', () => {
      expect(searchBody('valv', null).filtros).toHaveLength(3);
    });
  });

  describe('getSuppliers', () => {
    /**
     * El paginado de proveedores corre sobre `party_roles` y el nombre vive en `parties` desde la
     * unificación de terceros: pedir `t.name` es un `400` del generador SQL, no un orden distinto,
     * y con él la pantalla de compras abre sin proveedores para elegir.
     */
    it('orders by the name of the identity, which is where it lives', () => {
      api.getSuppliers().subscribe();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.SUPPLIERS.PAGINATE));
      expect(request.request.body.ordenes).toEqual([
        { tabla: 'parties', columna: 'name', direccion: 'ASC' },
      ]);

      request.flush({ content: [] });
    });
  });

  describe('getModels', () => {
    /**
     * Los modelos salen de su propio paginado, entero y por nombre: es la lista de un desplegable, y
     * el modelo es de la empresa —qué variantes tiene en la sucursal se pregunta al elegirlo—.
     */
    it('lists the whole model catalogue ordered by name', () => {
      api.getModels().subscribe();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCT_MODELS.PAGINATE));
      expect(request.request.body).toEqual({
        page: 1,
        size: 500,
        ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
      });

      request.flush({ content: [] });
    });
  });
});
