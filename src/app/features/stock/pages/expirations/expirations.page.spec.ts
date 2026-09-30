import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { ExpirationsPage } from './expirations.page';

describe('ExpirationsPage', () => {
  let fixture: ComponentFixture<ExpirationsPage>;
  let http: HttpTestingController;

  const CATEGORY_TREE = [
    {
      uuid: 'cat-farmacia',
      name: 'Farmacia',
      subCategories: [{ uuid: 'cat-antibioticos', name: 'Antibióticos', subCategories: null }],
    },
  ];

  const EMPTY_PAGE = { rows: [], total: 0, page: 0, size: 25, today: '2026-09-02', alertDays: 30 };
  const EMPTY_SUMMARY = {
    expiredBatches: 0,
    expiredQuantity: 0,
    expiredValue: 0,
    dueSoonBatches: 0,
    dueSoonProducts: 0,
    dueSoonDays: 7,
    alertBatches: 0,
    alertProducts: 0,
    alertDays: 30,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpirationsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        // Sin `stock.view_all_branches`: el alcance es la sucursal activa y no se piden sucursales.
        { provide: AuthService, useValue: { hasPermission: () => false } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ExpirationsPage);
  });

  afterEach(() => http.verify());

  /**
   * La pantalla se resuelve sola, con lo que provee ella y lo que vive en `core`: el árbol de
   * categorías lo trae su propio servicio. Cruzar a `features/categories` por el suyo dejaba la
   * ruta sin proveedor (NG0201), porque ese servicio sólo lo proveen las pantallas de esa feature.
   */
  it('arranca con sus propios proveedores y arma el filtro de categorías con el árbol', () => {
    fixture.detectChanges();

    http
      .expectOne((request) => request.url === apiUrl(API_ENDPOINTS.STOCK.EXPIRATIONS))
      .flush(EMPTY_PAGE);
    http
      .expectOne((request) => request.url === apiUrl(API_ENDPOINTS.STOCK.EXPIRATIONS_SUMMARY))
      .flush(EMPTY_SUMMARY);
    http.expectOne(apiUrl(API_ENDPOINTS.WAREHOUSES.PAGINATE)).flush({ content: [] });
    http.expectOne(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE)).flush(CATEGORY_TREE);
    fixture.detectChanges();

    const page = fixture.componentInstance as unknown as {
      categories(): readonly { uuid: string; name: string; depth: number }[];
    };

    expect(page.categories().map((option) => [option.name, option.depth])).toEqual([
      ['Farmacia', 0],
      ['Antibióticos', 1],
    ]);
  });
});
