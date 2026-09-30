import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestRequest } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { PaginateFiltro } from '../../../../core/paginate';
import { LineChartComponent } from '../../../../shared/components/line-chart/line-chart.component';
import {
  PRICE_HISTORY_VIEW_PERMISSION,
  periodRange,
  toPaginateTimestamp,
} from '../../data-access/price-history.model';
import { ProductPriceHistoryPage } from './product-price-history.page';

/**
 * Chart.js dibuja sobre un `<canvas>`, que jsdom no implementa: el gráfico real no puede montarse
 * en un test. Se reemplaza por un doble que acepta las mismas entradas, que es justamente lo que
 * esta pantalla tiene que calcular bien.
 */
@Component({ selector: 'app-line-chart', template: '' })
class LineChartStubComponent {
  readonly xValues = input<readonly number[]>([]);
  readonly series = input<readonly unknown[]>([]);
  readonly valueFormat = input<unknown>();
  readonly valueTickFormat = input<unknown>();
  readonly tickFormat = input<unknown>();
  readonly tooltipDateFormat = input<unknown>();
  readonly ariaLabel = input('');
  readonly height = input('');
}

describe('ProductPriceHistoryPage', () => {
  let fixture: ComponentFixture<ProductPriceHistoryPage>;
  let http: HttpTestingController;
  let canViewPriceHistory: boolean;

  const PRODUCT_UUID = 'product-1';
  const BRANCH_UUID = 'branch-1';

  const PRODUCT = { uuid: PRODUCT_UUID, name: 'Válvula solenoide X-200' };
  const PRICE_LISTS = [
    { uuid: 'list-cost', name: 'Costo', isCost: true, isActive: true },
    { uuid: 'list-retail', name: 'Minorista', isPrincipal: true, isActive: true },
  ];

  /** Un mes atrás y hoy: la ventana con la que la pantalla arranca. */
  const defaultRange = (): { from: Date; to: Date } => periodRange('1M', new Date());

  const change = (fields: {
    uuid: string;
    daysAgo: number;
    price: number;
    oldPrice?: number | null;
    priceListUuid?: string;
    priceListName?: string;
  }) => ({
    uuid: fields.uuid,
    dateCreated: Date.now() - fields.daysAgo * 24 * 60 * 60 * 1000,
    price: fields.price,
    oldPrice: fields.oldPrice ?? null,
    changeType: fields.oldPrice == null ? 'CREATE' : 'UPDATE',
    source: 'MANUAL',
    product: { uuid: PRODUCT_UUID, name: PRODUCT.name },
    priceList: {
      uuid: fields.priceListUuid ?? 'list-retail',
      name: fields.priceListName ?? 'Minorista',
    },
    branch: { uuid: BRANCH_UUID, name: 'Casa central' },
  });

  /** Los dos pedidos al historial: el de la ventana y el que busca con qué precio entró. */
  const priceHistoryRequests = (): { changes: TestRequest; seeds: TestRequest } => {
    const requests = http.match(apiUrl(API_ENDPOINTS.PRICE_HISTORY.PAGINATE));
    expect(requests).toHaveLength(2);

    const isSeed = (request: TestRequest): boolean =>
      (request.request.body.filtros as PaginateFiltro[][])
        .flat()
        .some((filtro) => filtro.columna === 'date_created' && filtro.operacion === '<');

    const seeds = requests.find(isSeed);
    const changes = requests.find((request) => !isSeed(request));
    expect(seeds).toBeDefined();
    expect(changes).toBeDefined();

    return { changes: changes as TestRequest, seeds: seeds as TestRequest };
  };

  /** `http.match` consume los pedidos, así que se resuelven los ya tomados y no se vuelve a buscar. */
  const resolve = (
    requests: { changes: TestRequest; seeds: TestRequest },
    changes: unknown[] = [],
    seeds: unknown[] = [],
  ): void => {
    requests.changes.flush({ content: changes, last: true });
    requests.seeds.flush({ content: seeds, last: true });
    fixture.detectChanges();
  };

  const flushCatalogues = (): void => {
    http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${PRODUCT_UUID}`)).flush(PRODUCT);
    http.expectOne(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE)).flush({ content: PRICE_LISTS });
  };

  const flushLoad = (changes: unknown[] = [], seeds: unknown[] = []): void => {
    flushCatalogues();
    resolve(priceHistoryRequests(), changes, seeds);
  };

  const legendEntries = (): string[] =>
    Array.from(
      fixture.nativeElement.querySelectorAll('.price-history__legend-item') as NodeListOf<HTMLElement>,
    ).map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  const tableRowCount = (): number =>
    fixture.nativeElement.querySelectorAll('.price-history__table tbody tr').length;

  beforeEach(async () => {
    canViewPriceHistory = true;

    await TestBed.configureTestingModule({
      imports: [ProductPriceHistoryPage],
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
              permission === PRICE_HISTORY_VIEW_PERMISSION ? canViewPriceHistory : true,
            selectedBranchUuid: () => BRANCH_UUID,
            availableBranches: signal([{ uuid: BRANCH_UUID, name: 'Casa central', active: true }]),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { paramMap: convertToParamMap({ uuid: PRODUCT_UUID }) };
            },
          },
        },
      ],
    })
      .overrideComponent(ProductPriceHistoryPage, {
        remove: { imports: [LineChartComponent] },
        add: { imports: [LineChartStubComponent] },
      })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  const render = (): void => {
    fixture = TestBed.createComponent(ProductPriceHistoryPage);
    fixture.detectChanges();
  };

  /** Un mes es el período con el que la pantalla abre, y la sucursal activa la que acota la serie. */
  it('opens on the last month of the active branch', () => {
    render();

    const requests = priceHistoryRequests();
    const filtros = (requests.changes.request.body.filtros as PaginateFiltro[][]).flat();
    const range = defaultRange();

    expect(filtros).toContainEqual({
      tabla: 'products',
      columna: 'uuid',
      operacion: '=',
      valor: PRODUCT_UUID,
    });
    expect(filtros).toContainEqual({
      tabla: 'branches',
      columna: 'uuid',
      operacion: '=',
      valor: BRANCH_UUID,
    });
    expect(filtros).toContainEqual({
      tabla: 't',
      columna: 'date_created',
      operacion: '>=',
      valor: toPaginateTimestamp(range.from, 'start'),
    });

    flushCatalogues();
    resolve(requests);
  });

  it('builds one legend entry per list, with the price it closes the period at', () => {
    render();
    flushLoad([
      change({ uuid: 'c1', daysAgo: 10, price: 1180 }),
      change({ uuid: 'c2', daysAgo: 3, price: 1255, oldPrice: 1180 }),
      change({
        uuid: 'c3',
        daysAgo: 3,
        price: 745,
        oldPrice: 700,
        priceListUuid: 'list-cost',
        priceListName: 'Costo',
      }),
    ]);

    // El orden es el del catálogo, que es lo que fija el color de cada curva.
    expect(legendEntries()[0]).toContain('Costo');
    expect(legendEntries()[1]).toContain('Minorista');
    expect(legendEntries()[1]).toContain('1.255');
    expect(tableRowCount()).toBe(3);
  });

  /** Sin cambios en la ventana pero con un precio anterior, la serie es la línea plana que es. */
  it('draws the carried price when the period has no changes', () => {
    render();
    flushLoad([], [change({ uuid: 'seed', daysAgo: 90, price: 980 })]);

    expect(legendEntries()).toHaveLength(1);
    expect(legendEntries()[0]).toContain('980');
    expect(tableRowCount()).toBe(0);
  });

  it('refetches the series with the window of the period picked', () => {
    render();
    flushLoad();

    (
      fixture.componentInstance as unknown as { onPeriodChange(period: string): void }
    ).onPeriodChange('6M');
    fixture.detectChanges();

    const requests = priceHistoryRequests();
    const filtros = (requests.changes.request.body.filtros as PaginateFiltro[][]).flat();

    expect(filtros).toContainEqual({
      tabla: 't',
      columna: 'date_created',
      operacion: '>=',
      valor: toPaginateTimestamp(periodRange('6M', new Date()).from, 'start'),
    });

    resolve(requests);
  });

  /** Sin `price_history.view` el paginado sería un 403: la pantalla lo dice sin pedir nada. */
  it('asks for nothing without the permission', () => {
    canViewPriceHistory = false;
    render();

    http.verify();
    expect(fixture.nativeElement.textContent).toContain('products.priceHistory.noPermission');
  });
});
