import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Params, Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogOptions } from '../../../../core/confirm/confirm-dialog.model';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PaginateFiltro, PaginateQuery } from '../../../../core/paginate';
import { ProductCatalogRowDto, ProductLeafRow } from '../../data-access/product-grouping';
import { ProductPaginateDto } from '../../data-access/product.model';
import { ProductsPage } from './products.page';

const PRODUCT: ProductPaginateDto = {
  uuid: 'p-1',
  name: 'Café molido',
  sku: 'CAF-1',
  tracksStock: true,
  totalStock: 4,
  isForSale: true,
  isForPurchase: true,
  hasMovements: false,
};

function row(product: ProductPaginateDto): ProductCatalogRowDto {
  return { rowType: 'PRODUCT', product };
}

/** La fila del listado, que es lo que la acción recibe: el producto más de quién cuelga. */
function leaf(product: ProductPaginateDto, isVariant = false): ProductLeafRow {
  return { kind: 'product', product, isVariant };
}

describe('ProductsPage', () => {
  let fixture: ComponentFixture<ProductsPage>;
  let http: HttpTestingController;

  let permissions: string[];
  let queryParams: Params;
  let confirmAnswer: boolean;

  const confirmDialog = {
    confirm: vi.fn((options: ConfirmDialogOptions) => {
      lastConfirm = options;
      return of(confirmAnswer);
    }),
  };
  let lastConfirm: ConfirmDialogOptions | null = null;
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** La consulta pendiente al catálogo agrupado, ya respondida. Devuelve lo que se pidió. */
  const answerCatalog = (
    rows: readonly ProductCatalogRowDto[],
    totalCount = rows.length,
  ): PaginateQuery => {
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_CATALOG));
    const query = request.request.body as PaginateQuery;
    request.flush({ content: rows, totalCount });
    fixture.detectChanges();
    return query;
  };

  /** Los filtros de la consulta, aplanados: el paginado los manda como grupos AND de grupos OR. */
  const filtrosOf = (query: PaginateQuery): PaginateFiltro[] => (query.filtros ?? []).flat();

  /** Monta la pantalla y contesta las dos consultas de opciones, que lanza en cada `ngOnInit`. */
  const open = (): void => {
    TestBed.resetTestingModule();
    confirmDialog.confirm.mockClear();
    lastConfirm = null;
    toast.success.mockClear();
    toast.error.mockClear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        { provide: ConfirmDialogService, useValue: confirmDialog },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: { hasPermission: (permission: string) => permissions.includes(permission) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { queryParams };
            },
          },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    // La pantalla espeja los filtros en la URL después de cada cambio. Acá eso no se verifica, y el
    // `ActivatedRoute` de mentira no alcanza para que el router resuelva una ruta relativa contra
    // él: se neutraliza la navegación y se deja al router real, que es de quien cuelga el breadcrumb.
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProductsPage);
    fixture.detectChanges();

    http.expectOne(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE)).flush({ content: [] });
    http.expectOne(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE)).flush([]);
  };

  beforeEach(() => {
    permissions = ['product.edit', 'product.delete'];
    queryParams = {};
    confirmAnswer = true;
  });

  afterEach(() => {
    http.verify();
  });

  // ---------- El filtro por estado de circulación ----------

  /**
   * El listado abre mostrando lo que se vende y no el catálogo entero: el listado sin filtro es el
   * problema que el archivado y la discontinuación vinieron a resolver (ADR 0001).
   */
  it('abre filtrando por lo que está en venta', () => {
    open();
    const filtros = filtrosOf(answerCatalog([row(PRODUCT)]));

    expect(filtros).toContainEqual(
      expect.objectContaining({ tabla: 't', columna: 'is_for_sale', valor: 'true' }),
    );
  });

  /**
   * «Discontinuado» son las **dos** banderas apagadas, no la negación de «en venta»: con una sola
   * apagada el producto sigue circulando por el otro lado.
   */
  it('pide las dos banderas apagadas al filtrar por discontinuados', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onSaleStatusChange']('discontinued');
    const filtros = filtrosOf(answerCatalog([]));

    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'is_for_sale', valor: 'false' }),
    );
    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'is_for_purchase', valor: 'false' }),
    );
  });

  /** «Todos» es lo único que trae también al producto que se compra y no se vende. */
  it('no filtra por circulación en «todos»', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onSaleStatusChange'](null);
    const filtros = filtrosOf(answerCatalog([]));

    expect(filtros.some((filtro) => filtro.columna.startsWith('is_for_'))).toBe(false);
  });

  /** El link compartido llega filtrado como lo dejó quien lo mandó, no como abre la pantalla. */
  it('restaura el filtro desde la URL en vez de aplicar el default', () => {
    queryParams = { 'f.forSale.equals': 'false', 'f.forPurchase.equals': 'false' };
    open();

    const filtros = filtrosOf(answerCatalog([]));
    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'is_for_sale', valor: 'false' }),
    );
    expect(fixture.componentInstance['saleStatusFilter']()).toBe('discontinued');
  });

  /** Y el panel se abre solo, o el link llegaría filtrado sin nada que explique las filas que faltan. */
  it('abre el panel de filtros cuando la URL trae un estado que no es el default', () => {
    queryParams = { 'f.forSale.equals': 'false', 'f.forPurchase.equals': 'false' };
    open();
    answerCatalog([]);

    expect(fixture.componentInstance['filtersOpen']()).toBe(true);
  });

  /** Limpiar devuelve el listado a como abre, no a «todos». */
  it('vuelve a «en venta» al limpiar los filtros', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onSaleStatusChange'](null);
    answerCatalog([]);
    fixture.componentInstance['onClearFilters']();

    const filtros = filtrosOf(answerCatalog([]));
    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'is_for_sale', valor: 'true' }),
    );
  });

  /**
   * «Todos» es la ausencia de filtro, así que sin una marca propia no se distingue de un link que no
   * habla de circulación — y uno de los dos casos tiene que abrir mal.
   */
  it('restaura «todos» desde su marca en la URL', () => {
    queryParams = { status: 'all' };
    open();

    const filtros = filtrosOf(answerCatalog([]));
    expect(filtros.some((filtro) => filtro.columna.startsWith('is_for_'))).toBe(false);
    expect(fixture.componentInstance['saleStatusFilter']()).toBe(null);
  });

  /** Y un link que no dice nada —un favorito anterior al filtro— abre con el default puesto. */
  it('aplica el default a un link que no habla de circulación', () => {
    queryParams = { q: 'cafe' };
    open();

    // Dos consultas salen juntas: la que restaura la URL y, detrás, la que le suma el default. Es
    // el precio de este caso —un link hecho por esta pantalla siempre dice cuál de los tres quiso—.
    const requests = http.match(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_CATALOG));
    expect(requests).toHaveLength(2);
    requests.forEach((request) => request.flush({ content: [], totalCount: 0 }));
    fixture.detectChanges();

    const filtros = filtrosOf(requests[1].request.body as PaginateQuery);
    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'is_for_sale', valor: 'true' }),
    );
    expect(fixture.componentInstance['saleStatusFilter']()).toBe('onSale');
  });

  // ---------- El chip ----------

  it('marca la fila del producto que no se compra ni se vende', () => {
    open();
    answerCatalog([row({ ...PRODUCT, isForSale: false, isForPurchase: false })]);

    expect(host().textContent).toContain('products.chips.discontinued');
  });

  it('no marca la fila del producto que sigue en venta', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    expect(host().textContent).not.toContain('products.chips.discontinued');
  });

  // ---------- Archivar ----------

  /** Sin `product.delete` la acción no existe: no se ofrece algo que el backend va a rechazar. */
  it('no ofrece archivar sin permiso', () => {
    permissions = ['product.edit'];
    open();
    answerCatalog([row(PRODUCT)]);

    const ids = fixture.componentInstance['rowActions']().map((action) => action.id);
    expect(ids).not.toContain('archive');
  });

  it('ofrece archivar con permiso', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    const ids = fixture.componentInstance['rowActions']().map((action) => action.id);
    expect(ids).toContain('archive');
  });

  /**
   * El diálogo lleva las consecuencias, no sólo el nombre: archivar no se deshace y el usuario tiene
   * que poder evaluar qué pierde antes de confirmar.
   */
  it('pide confirmación diciendo qué se pierde', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT));
    http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`)).flush(PRODUCT);

    // La recarga que dispara el archivado, para no dejarla colgando.
    answerCatalog([]);

    const message = lastConfirm?.message ?? '';
    expect(message).toContain('products.archive.irreversible');
    expect(message).toContain('products.archive.stockLost');
    expect(message).toContain('products.archive.codeReleased');
  });

  it('no borra nada si se cancela', () => {
    confirmAnswer = false;
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT));

    http.expectNone(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('archiva, avisa y recarga la grilla', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT));
    http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`)).flush(PRODUCT);

    expect(toast.success).toHaveBeenCalledWith('products.toasts.archived');
    // La recarga: la grilla vuelve a pedir la página después de archivar.
    answerCatalog([]);
  });

  /**
   * Al archivar la última fila de la página hay que retroceder, o la grilla queda vacía mostrando
   * una página que ya no existe.
   */
  it('retrocede de página al archivar la última fila', () => {
    open();
    // Once filas en total: la segunda página tiene una sola, la que se archiva.
    answerCatalog([row(PRODUCT)], 11);
    fixture.componentInstance['onPage']({ pageIndex: 1, pageSize: 10, length: 11 });
    answerCatalog([row(PRODUCT)], 11);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT));
    http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`)).flush(PRODUCT);

    expect(answerCatalog([], 10).page).toBe(1);
  });

  /**
   * El contador del paginador cuenta **filas del catálogo**: un modelo con doce variantes es una
   * fila sola. Archivar una variante no le quita una fila a la página, así que restarle uno al total
   * haría retroceder una página que no se vació.
   */
  it('no retrocede de página al archivar una variante de un modelo', () => {
    open();
    answerCatalog([row(PRODUCT)], 11);
    fixture.componentInstance['onPage']({ pageIndex: 1, pageSize: 10, length: 11 });
    answerCatalog([row(PRODUCT)], 11);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT, true));
    http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`)).flush(PRODUCT);

    expect(answerCatalog([], 11).page).toBe(2);
  });

  // ---------- Las variantes de un modelo expandido ----------

  /**
   * Expandir un modelo no puede contradecir al filtro que lo trajo: con «en venta» puesto arriba, la
   * fila desplegada no puede listar las variantes discontinuadas.
   */
  it('pide las variantes de un modelo con el mismo estado de circulación', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onToggleModel']('model-1');
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL));
    const filtros = filtrosOf(request.request.body as PaginateQuery);
    request.flush({ content: [] });

    expect(filtros).toContainEqual(
      expect.objectContaining({ tabla: 't', columna: 'is_for_sale', valor: 'true' }),
    );
  });

  /** Y en «todos» no se le impone ninguno, igual que arriba. */
  it('no filtra las variantes por circulación en «todos»', () => {
    open();
    answerCatalog([row(PRODUCT)]);
    fixture.componentInstance['onSaleStatusChange'](null);
    answerCatalog([]);

    fixture.componentInstance['onToggleModel']('model-1');
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL));
    const filtros = filtrosOf(request.request.body as PaginateQuery);
    request.flush({ content: [] });

    expect(filtros.some((filtro) => filtro.columna.startsWith('is_for_'))).toBe(false);
  });

  /** Cambiar el filtro tira las variantes que ya se habían pedido: salieron con el estado anterior. */
  it('vuelve a pedir las variantes cuando cambia el estado', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onToggleModel']('model-1');
    http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL)).flush({ content: [] });

    fixture.componentInstance['onSaleStatusChange']('discontinued');
    answerCatalog([]);

    fixture.componentInstance['onToggleModel']('model-1');
    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE_ALL));
    const filtros = filtrosOf(request.request.body as PaginateQuery);
    request.flush({ content: [] });

    expect(filtros).toContainEqual(
      expect.objectContaining({ columna: 'is_for_sale', valor: 'false' }),
    );
  });

  /**
   * El componente de un kit vivo no se archiva, y el backend manda el nombre del kit en el
   * `userMessage`: la salida —sacarlo de la composición primero— se lee sin abrir otra pantalla.
   */
  it('muestra el mensaje del backend cuando el producto compone un kit', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT));
    http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`)).flush(
      {
        errorCode: 'PRODUCT_IN_USE_BY_KIT',
        userMessage: 'El producto compone el kit "Desayuno completo".',
      },
      { status: 409, statusText: 'Conflict' },
    );

    expect(toast.error).toHaveBeenCalledWith('El producto compone el kit "Desayuno completo".');
  });

  /** Cualquier otra falla cae en el mensaje genérico, que es el que la pantalla sí controla. */
  it('cae en el mensaje propio ante una falla que no es la del kit', () => {
    open();
    answerCatalog([row(PRODUCT)]);

    fixture.componentInstance['onRowAction']('archive', leaf(PRODUCT));
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.DELETE}/p-1`))
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(toast.error).toHaveBeenCalledWith('products.toasts.archiveError');
  });
});
