import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import {
  PRICE_RULE_VIEW_PERMISSION,
  SUPPLIER_VIEW_PERMISSION,
} from '../../data-access/product.model';
import { ProductFormPage } from './product-form.page';

describe('ProductFormPage', () => {
  let fixture: ComponentFixture<ProductFormPage>;
  let http: HttpTestingController;
  let routeTab: string | null;
  let canAssignBranches: boolean;
  let canViewPriceRules: boolean;
  let canViewSuppliers: boolean;
  /** `uuid` de la ruta: `null` es alta, cualquier otro valor pone la pantalla en edición. */
  let routeUuid: string | null;
  /** Lo que contesta el diálogo de confirmación al cambiar el control de existencias. */
  let confirmAnswer: boolean;
  /** El detalle que devuelve `GET /product/uuid/{uuid}`: se pisa para probar el archivado. */
  let productDetail: object;
  const confirmDialog = { confirm: vi.fn(() => of(confirmAnswer)) };

  const BRANDS = [{ uuid: 'brand-1', name: 'FlowTec' }];
  const CATEGORY_TREE = [
    {
      uuid: 'cat-1',
      name: 'Válvulas',
      subCategories: [{ uuid: 'cat-2', name: 'Bronce', subCategories: null }],
    },
  ];
  const PRICE_LISTS = [
    { uuid: 'list-retail', name: 'Minorista', isPrincipal: true, isActive: true, isCost: false },
    {
      uuid: 'list-wholesale',
      name: 'Mayorista',
      isPrincipal: false,
      isActive: true,
      isCost: false,
    },
  ];
  const BRANCHES = [
    { uuid: 'branch-1', name: 'Casa central', active: true },
    { uuid: 'branch-2', name: 'Sucursal norte', active: true },
  ];

  const SUPPLIERS = [
    { uuid: 'supplier-1', name: 'Distribuidora Norte' },
    { uuid: 'supplier-2', name: 'Bombas del Sur' },
  ];

  const PRODUCT = {
    uuid: 'product-1',
    version: 3,
    name: 'Válvula solenoide X-200',
    sku: 'ISV-X200',
    barcode: '779123456',
    unitMeasure: 'KILOGRAM',
    taxRate: 10.5,
    lowStock: 5,
    optimalStock: 40,
    isForSale: true,
    isForPurchase: false,
    brand: { uuid: 'brand-1', name: 'FlowTec' },
    category: { uuid: 'cat-2', name: 'Bronce' },
    categoryAttributes: [{ attributeUuid: 'attr-color', value: 'Bronce pulido' }],
    priceListEntries: [{ priceListUuid: 'list-wholesale', price: 980 }],
    branches: [{ uuid: 'branch-1', name: 'Casa central' }],
    // El segundo no está entre las opciones del select a propósito: es el proveedor que la pantalla
    // no puede listar (empresa con más de una página de proveedores, o permiso recortado).
    suppliers: [
      { uuid: 'supplier-1', name: 'Distribuidora Norte' },
      { uuid: 'supplier-legacy', name: 'Mayorista de siempre' },
    ],
    cost: 700,
    costMethod: 'FIFO',
  };

  /** Regla que alcanza al producto y recalcula sólo la lista mayorista en la sucursal activa. */
  const PRICE_RULE = {
    uuid: 'rule-1',
    name: 'Mayorista +35',
    ruleType: 'MARKUP_PERCENT',
    priceLists: [{ priceList: { uuid: 'list-wholesale', name: 'Mayorista' }, percent: 35 }],
  };

  /** Resuelve el `GET /price-rule/product/{uuid}`; `null` es el 204 con el que responde sin regla. */
  const flushPriceRule = (priceRule: object | null): void => {
    const request = http.expectOne(apiUrl(`${API_ENDPOINTS.PRICE_RULES.BY_PRODUCT}/${routeUuid}`));

    if (priceRule === null) {
      request.flush(null, { status: 204, statusText: 'No Content' });
    } else {
      request.flush(priceRule);
    }
  };

  /**
   * Resuelve los catálogos que la pantalla pide al iniciar, más el detalle del producto y su regla
   * de precio cuando la ruta trae un uuid. En la edición todo eso llega en un mismo `forkJoin`, y
   * recién cuando aterriza se piden los atributos de la categoría del producto.
   */
  const flushCatalogues = (attributes: unknown[] = [], priceRule: object | null = null): void => {
    http.expectOne(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE)).flush({ content: BRANDS });
    http.expectOne(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE)).flush(CATEGORY_TREE);
    http.expectOne(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE)).flush({ content: PRICE_LISTS });
    if (canAssignBranches) {
      http.expectOne(apiUrl(API_ENDPOINTS.BRANCHES.PAGINATE)).flush({ content: BRANCHES });
    }
    if (canViewSuppliers) {
      http.expectOne(apiUrl(API_ENDPOINTS.SUPPLIERS.PAGINATE)).flush({ content: SUPPLIERS });
    }
    if (routeUuid) {
      http
        .expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${routeUuid}`))
        .flush(productDetail);
      if (canViewPriceRules) {
        flushPriceRule(priceRule);
      }
      http
        .expectOne(apiUrl(`${API_ENDPOINTS.CATEGORIES.ATTRIBUTES}/${PRODUCT.category.uuid}`))
        .flush(attributes);
    }
    fixture.detectChanges();
  };

  const selectCategory = (uuid: string, attributes: unknown[]): void => {
    (
      fixture.componentInstance as unknown as { onCategoryChange(u: string): void }
    ).onCategoryChange(uuid);
    http.expectOne(apiUrl(`${API_ENDPOINTS.CATEGORIES.ATTRIBUTES}/${uuid}`)).flush(attributes);
    fixture.detectChanges();
  };

  /** Rellena el formulario con un alta mínima válida. */
  const fillRequiredFields = (): void => {
    const page = fixture.componentInstance as unknown as {
      productForm: {
        name: () => { value: { set(v: string): void } };
        sku: () => { value: { set(v: string): void } };
      };
    };
    page.productForm.name().value.set('Válvula solenoide X-200');
    page.productForm.sku().value.set('ISV-X200');
    fixture.detectChanges();
  };

  const submit = (): void => {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  /**
   * Las dos puntas del precio de cada fila —neta y final— indexadas por el nombre de la lista. Se
   * buscan por posición y no por `aria-label`: el label es una traducción, y el `TranslateService`
   * de los tests no tiene catálogo cargado.
   */
  const priceRows = (): Record<string, { net: HTMLInputElement; final: HTMLInputElement }> => {
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll(
        'section[aria-labelledby="price-lists-title"] .product-form__table tbody tr',
      ),
    ) as HTMLElement[];

    return Object.fromEntries(
      rows.map((row) => {
        const name = row.querySelector('.product-form__price-name')?.textContent?.trim() ?? '';
        const [net, final] = Array.from(row.querySelectorAll('input')) as HTMLInputElement[];

        return [name, { net, final }];
      }),
    );
  };

  /** Material sólo monta el contenido de la solapa activa: sin abrirla no hay grilla que mirar. */
  const openPricingTab = async (): Promise<void> => {
    (
      fixture.componentInstance as unknown as { selectedTab: { set(i: number): void } }
    ).selectedTab.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** La sección de rentabilidad, que vive debajo de la grilla de precios en la misma solapa. */
  const marginsSection = (): HTMLElement =>
    fixture.nativeElement.querySelector('section[aria-labelledby="margins-title"]');

  /** Los porcentajes de cada fila de la grilla de márgenes, indexados por el nombre de la lista. */
  const marginRows = (): Record<string, { margin: string; markup: string }> => {
    const rows = Array.from(
      marginsSection().querySelectorAll('.product-form__table tbody tr'),
    ) as HTMLElement[];

    return Object.fromEntries(
      rows.map((row) => {
        const [margin, markup] = Array.from(
          row.querySelectorAll('.product-form__table-percent'),
        ) as HTMLElement[];

        return [
          row.querySelector('th')?.textContent?.trim() ?? '',
          {
            margin: margin.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            markup: markup.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          },
        ];
      }),
    );
  };

  /** Tipea en un input como lo haría el usuario: `[formField]` y el handler escuchan `input`. */
  const type = async (input: HTMLInputElement, value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    canAssignBranches = true;
    canViewPriceRules = true;
    canViewSuppliers = true;
    routeUuid = null;
    routeTab = null;
    confirmAnswer = true;
    productDetail = PRODUCT;
    confirmDialog.confirm.mockClear();

    await TestBed.configureTestingModule({
      imports: [ProductFormPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService(),
        { provide: ConfirmDialogService, useValue: confirmDialog },
        {
          provide: AuthService,
          useValue: {
            hasPermission: (permission: string) => {
              if (permission === PRICE_RULE_VIEW_PERMISSION) {
                return canViewPriceRules;
              }
              if (permission === SUPPLIER_VIEW_PERMISSION) {
                return canViewSuppliers;
              }
              return canAssignBranches;
            },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return {
                paramMap: convertToParamMap(routeUuid ? { uuid: routeUuid } : {}),
                // `?tab=stock` es cómo la grilla entra directo a la solapa de stock.
                queryParamMap: convertToParamMap(routeTab ? { tab: routeTab } : {}),
              };
            },
          },
        },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  const render = (): void => {
    fixture = TestBed.createComponent(ProductFormPage);
    fixture.detectChanges();
  };

  it('seeds one editable price per active price list', async () => {
    render();
    flushCatalogues();
    await openPricingTab();

    expect(Object.keys(priceRows())).toEqual(['Minorista', 'Mayorista']);
    expect(priceRows()['Minorista'].net.disabled).toBe(false);
    expect(priceRows()['Minorista'].final.disabled).toBe(false);
  });

  /**
   * El alta marca todas las sucursales activas y eso es la línea de base del guard: la preselección
   * no la escribió el usuario, así que salir sin tocar nada no tiene que preguntar nada.
   */
  it('starts with every active branch selected, and counts it as no change', () => {
    render();
    flushCatalogues();

    const page = fixture.componentInstance as unknown as { model: () => Record<string, unknown> };

    expect(page.model()).toMatchObject({ branchUuids: ['branch-1', 'branch-2'] });
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
  });

  it('rebuilds the attribute grid from the chosen category', () => {
    render();
    flushCatalogues();

    selectCategory('cat-1', [
      { uuid: 'attr-color', name: 'Color', type: 'text' },
      { uuid: 'attr-stock', name: 'Certificado', type: 'boolean' },
    ]);

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('mat-label, mat-slide-toggle'),
    ).map((element) => (element as HTMLElement).textContent?.trim());

    expect(labels).toContain('Color');
    expect(labels).toContain('Certificado');
  });

  it('does not save while a required field is missing, and lands on the tab that holds it', () => {
    render();
    flushCatalogues();

    submit();

    http.expectNone(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    expect(
      (fixture.componentInstance as unknown as { selectedTab: () => number }).selectedTab(),
    ).toBe(0);
  });

  it('posts only the branches, prices and attributes that carry a value', async () => {
    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-2', [
      { uuid: 'attr-color', name: 'Color', type: 'text' },
      { uuid: 'attr-peso', name: 'Peso', type: 'decimal' },
    ]);

    const page = fixture.componentInstance as unknown as {
      productForm: { prices: { price: () => { value: { set(v: number | null): void } } }[] };
      onAttributeBooleanChange(index: number, checked: boolean): void;
      onBranchToggle(uuid: string, checked: boolean): void;
    };
    // Sólo la primera lista lleva precio; la segunda queda sin precio a propósito.
    page.productForm.prices[0].price().value.set(150);
    // El alta arranca con todas las sucursales marcadas: se desmarca una para que no viaje.
    page.onBranchToggle('branch-2', false);
    fixture.detectChanges();

    submit();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    expect(request.request.body).toMatchObject({
      name: 'Válvula solenoide X-200',
      sku: 'ISV-X200',
      unitMeasure: 'UNIT',
      taxRate: 21,
      isForSale: true,
      isForPurchase: true,
      category: { uuid: 'cat-2' },
      brand: null,
      // Los ejes viajan siempre, con el default del producto de siempre; la grilla vacía deja al
      // producto sin código y el campo único ya no viaja: lo deriva el backend.
      type: 'SIMPLE',
      stockTracking: 'QUANTITY',
      expirationControl: 'NONE',
      barcodes: [],
      priceListEntries: [{ priceListUuid: 'list-retail', price: 150 }],
      branches: [{ uuid: 'branch-1' }],
    });
    expect('barcode' in request.request.body).toBe(false);
    // Los atributos sin valor no viajan, así que el alta no lleva `categoryAttributes`.
    expect(request.request.body.categoryAttributes).toBeUndefined();
    // Un alta no tiene versión previa que reenviar: el backend sólo la valida cuando hay `uuid`.
    expect('version' in request.request.body).toBe(false);

    request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
    await fixture.whenStable();
  });

  it('omits branches when the user cannot assign them', async () => {
    canAssignBranches = false;
    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-1', []);

    submit();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    expect('branches' in request.request.body).toBe(false);

    request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
    await fixture.whenStable();
  });

  it('posts the suppliers picked from the autocomplete', async () => {
    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-1', []);

    const page = fixture.componentInstance as unknown as {
      onSupplierSelected(supplier: { uuid: string; name: string }): void;
      onRemoveSupplier(uuid: string): void;
    };
    page.onSupplierSelected(SUPPLIERS[0]);
    page.onSupplierSelected(SUPPLIERS[1]);
    // Elegido y sacado: el que se quita no viaja.
    page.onRemoveSupplier(SUPPLIERS[1].uuid);
    fixture.detectChanges();

    submit();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    expect(request.request.body.suppliers).toEqual([{ uuid: 'supplier-1' }]);

    request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
    await fixture.whenStable();
  });

  it('posts an empty list when no supplier is picked, which is how the link clears', async () => {
    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-1', []);

    submit();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    expect(request.request.body.suppliers).toEqual([]);

    request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
    await fixture.whenStable();
  });

  it('omits suppliers when the user cannot list them, so the link is left untouched', async () => {
    canViewSuppliers = false;
    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-1', []);

    submit();

    const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    expect('suppliers' in request.request.body).toBe(false);

    request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
    await fixture.whenStable();
  });

  it('lands on the products list once the product is created', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-1', []);

    submit();
    http
      .expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE))
      .flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/panel/products']);
  });

  /**
   * El SKU es el único campo que puede volver rechazado por el backend: la unicidad es por empresa
   * y sólo la base la conoce. La pantalla lo trata como un error de campo, no como un toast suelto,
   * porque hay tres solapas y el usuario no tiene por qué adivinar en cuál está el problema.
   */
  it('marks the SKU and comes back to its tab when the backend reports it as duplicate', async () => {
    render();
    flushCatalogues();
    fillRequiredFields();
    selectCategory('cat-1', []);

    const page = fixture.componentInstance as unknown as {
      selectedTab: { (): number; set(value: number): void };
      productForm: { sku: () => { errors(): readonly { kind: string }[] } };
    };
    // El submit se dispara desde otra solapa: el error tiene que traer al usuario de vuelta.
    page.selectedTab.set(2);

    submit();
    http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE)).flush(
      {
        status: 'CONFLICT',
        errorCode: 'PRODUCT_SKU_DUPLICATE',
        userMessage: "SKU duplicado. Ya existe el producto 'Válvula vieja' con el SKU 'ISV-X200'.",
        data: { sku: 'ISV-X200', productUuid: 'product-9', productName: 'Válvula vieja' },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(page.selectedTab()).toBe(0);
    expect(
      page.productForm
        .sku()
        .errors()
        .map((error) => error.kind),
    ).toContain('skuDuplicate');
  });

  /**
   * Los tres ejes del producto. Lo que la combinación no permite queda deshabilitado y visible;
   * el modelo además guarda el valor forzado, así el payload es el que el backend acepta.
   */
  describe('tipo y control de existencias', () => {
    interface AxesPage {
      model: () => Record<string, unknown>;
      tracksStock(): boolean;
      onTypeChange(type: string): void;
      onStockTrackingChange(mode: string): void;
      onExpirationControlChange(control: string): void;
      onAddBarcode(): void;
      onRemoveBarcode(index: number): void;
      onSetPrimaryBarcode(index: number): void;
      productForm: {
        stockTracking: () => { disabled(): boolean; errors(): readonly { kind: string }[] };
        expirationControl: () => { disabled(): boolean };
        expirationAlertDays: () => { disabled(): boolean };
        lowStock: () => { disabled(): boolean };
        optimalStock: () => { disabled(): boolean };
        standardCost: () => { disabled(): boolean };
        barcodes: {
          (): { errors(): readonly { kind: string }[] };
          [index: number]: {
            barcode: () => {
              value: { set(v: string): void };
              errors(): readonly { kind: string }[];
            };
          };
        };
      };
      selectedTab: { (): number; set(value: number): void };
    }

    const page = (): AxesPage => fixture.componentInstance as unknown as AxesPage;

    const tabCount = (): number => fixture.nativeElement.querySelectorAll('[role="tab"]').length;

    it('starts as the product of always: simple, by quantity, without expiration', () => {
      render();
      flushCatalogues();

      expect(page().model()).toMatchObject({
        productType: 'SIMPLE',
        stockTracking: 'QUANTITY',
        expirationControl: 'NONE',
        expirationAlertDays: null,
        standardCost: null,
        barcodes: [],
      });
      expect(page().productForm.stockTracking().disabled()).toBe(false);
      expect(page().productForm.expirationControl().disabled()).toBe(true);
      expect(page().productForm.lowStock().disabled()).toBe(false);
      expect(page().productForm.standardCost().disabled()).toBe(true);
    });

    it('switches the stock block off for a service and drops the Stock tab', () => {
      routeUuid = 'product-1';
      render();
      flushCatalogues([]);
      // General, precios, inventario, empaques y stock.
      expect(tabCount()).toBe(5);

      page().onTypeChange('SERVICE');
      fixture.detectChanges();

      expect(page().model()).toMatchObject({
        productType: 'SERVICE',
        stockTracking: 'NONE',
        expirationControl: 'NONE',
      });
      expect(page().productForm.stockTracking().disabled()).toBe(true);
      expect(page().productForm.lowStock().disabled()).toBe(true);
      expect(page().productForm.optimalStock().disabled()).toBe(true);
      expect(page().productForm.standardCost().disabled()).toBe(false);
      expect(page().tracksStock()).toBe(false);
      expect(tabCount()).toBe(4);
    });

    it('enables expiration only with batches or serial numbers', () => {
      render();
      flushCatalogues();

      page().onStockTrackingChange('BATCH');
      fixture.detectChanges();
      expect(page().productForm.expirationControl().disabled()).toBe(false);
      expect(page().productForm.expirationAlertDays().disabled()).toBe(true);

      page().onExpirationControlChange('REQUIRED');
      fixture.detectChanges();
      expect(page().productForm.expirationAlertDays().disabled()).toBe(false);

      // Volver a cantidad deja el vencimiento sin lugar: el valor cae a «no aplica».
      page().onStockTrackingChange('QUANTITY');
      fixture.detectChanges();
      expect(page().model()).toMatchObject({ stockTracking: 'QUANTITY', expirationControl: 'NONE' });
      expect(page().productForm.expirationControl().disabled()).toBe(true);
    });

    it('posts the axes and the barcode grid, with the primary marked', async () => {
      render();
      flushCatalogues();
      fillRequiredFields();
      selectCategory('cat-1', []);

      page().onStockTrackingChange('BATCH');
      page().onExpirationControlChange('OPTIONAL');
      page().onAddBarcode();
      page().onAddBarcode();
      fixture.detectChanges();
      page().productForm.barcodes[0].barcode().value.set('7790001');
      page().productForm.barcodes[1].barcode().value.set(' 7790002 ');
      page().onSetPrimaryBarcode(1);
      fixture.detectChanges();

      submit();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
      expect(request.request.body).toMatchObject({
        type: 'SIMPLE',
        stockTracking: 'BATCH',
        expirationControl: 'OPTIONAL',
        barcodes: [
          { barcode: '7790001', isPrimary: false },
          { barcode: '7790002', isPrimary: true },
        ],
      });
      request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
      await fixture.whenStable();
    });

    it('never leaves the grid without a primary: removing it promotes the first left', () => {
      render();
      flushCatalogues();

      page().onAddBarcode();
      page().onAddBarcode();
      page().onSetPrimaryBarcode(1);
      page().onRemoveBarcode(1);
      fixture.detectChanges();

      expect(page().model()).toMatchObject({ barcodes: [{ barcode: '', isPrimary: true }] });
    });

    it('rejects the same code twice in the grid before saving', () => {
      render();
      flushCatalogues();

      page().onAddBarcode();
      page().onAddBarcode();
      fixture.detectChanges();
      page().productForm.barcodes[0].barcode().value.set('7790001');
      page().productForm.barcodes[1].barcode().value.set('7790001 ');
      fixture.detectChanges();

      expect(
        page()
          .productForm.barcodes[1].barcode()
          .errors()
          .map((error) => error.kind),
      ).toContain('duplicateBarcode');
    });

    it('marks the barcode grid and comes back to its tab when the backend reports a duplicate', async () => {
      render();
      flushCatalogues();
      fillRequiredFields();
      selectCategory('cat-1', []);
      page().onAddBarcode();
      fixture.detectChanges();
      page().productForm.barcodes[0].barcode().value.set('7790001');
      page().selectedTab.set(2);

      submit();
      http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE)).flush(
        {
          status: 'CONFLICT',
          errorCode: 'DUPLICATE_PRODUCT_BARCODE',
          userMessage: "Código de barras duplicado. Ya existe el producto 'Otro' con el código '7790001'.",
          data: { barcode: '7790001', productUuid: 'product-9', productName: 'Otro' },
        },
        { status: 409, statusText: 'Conflict' },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      expect(page().selectedTab()).toBe(0);
      expect(
        page()
          .productForm.barcodes()
          .errors()
          .map((error) => error.kind),
      ).toContain('barcodeDuplicate');
    });

    describe('edición', () => {
      beforeEach(() => {
        routeUuid = 'product-1';
      });

      /**
       * Cambiar el control de existencias reescribe cómo se lleva el inventario: la pantalla lo
       * explica antes de mandarlo, y sin confirmación no hay request.
       */
      it('asks before saving with another stock control, and drops the save when declined', async () => {
        render();
        flushCatalogues([]);
        page().onStockTrackingChange('BATCH');
        fixture.detectChanges();

        confirmAnswer = false;
        submit();
        await fixture.whenStable();
        http.expectNone(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
        expect(confirmDialog.confirm).toHaveBeenCalledTimes(1);

        confirmAnswer = true;
        submit();
        await fixture.whenStable();
        const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
        expect(request.request.body).toMatchObject({ uuid: 'product-1', stockTracking: 'BATCH' });
        request.flush({ ...PRODUCT, stockTracking: 'BATCH', version: 4 });
        await fixture.whenStable();
      });

      it('does not ask when the stock control is the one it loaded', async () => {
        render();
        flushCatalogues([]);

        submit();
        await fixture.whenStable();
        expect(confirmDialog.confirm).not.toHaveBeenCalled();
        http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE)).flush({ ...PRODUCT, version: 4 });
        await fixture.whenStable();
      });

      it('marks the stock control when the backend rejects the transition', async () => {
        render();
        flushCatalogues([]);
        page().onStockTrackingChange('NONE');
        fixture.detectChanges();

        submit();
        await fixture.whenStable();
        http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE)).flush(
          {
            status: 'BAD_REQUEST',
            errorCode: 'PRODUCT_STOCK_TRACKING_CHANGE_NOT_ALLOWED',
            userMessage: 'No se puede cambiar el control de existencias de QUANTITY a NONE: el producto tiene saldo (12.0).',
            data: { from: 'QUANTITY', to: 'NONE' },
          },
          { status: 400, statusText: 'Bad Request' },
        );
        // El guardado pasó por el diálogo de confirmación: un salto más en la cadena de promesas
        // que `whenStable` no alcanza a cubrir antes de que el error aterrice en el campo.
        await fixture.whenStable();
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();

        expect(
          page()
            .productForm.stockTracking()
            .errors()
            .map((error) => error.kind),
        ).toContain('stockTrackingRejected');
      });
    });
  });

  /**
   * Lo que mira `unsavedChangesGuard` para frenar la salida. El predicado compara el modelo contra
   * una foto en vez de leer `dirty()` porque los selects, los toggles y las grillas de esta
   * pantalla escriben por fuera del control y nunca encienden ese flag.
   */
  describe('cambios sin guardar', () => {
    it('starts clean once the catalogues are in', () => {
      render();
      flushCatalogues();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('notices a change made outside a formField control', () => {
      render();
      flushCatalogues();

      (
        fixture.componentInstance as unknown as { onForSaleChange(checked: boolean): void }
      ).onForSaleChange(false);
      fixture.detectChanges();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });

    it('goes back to clean when the user undoes what they typed', () => {
      render();
      flushCatalogues();
      fillRequiredFields();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);

      const page = fixture.componentInstance as unknown as {
        productForm: {
          name: () => { value: { set(v: string): void } };
          sku: () => { value: { set(v: string): void } };
        };
      };
      page.productForm.name().value.set('');
      page.productForm.sku().value.set('');
      fixture.detectChanges();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('lets the post-save navigation through', async () => {
      render();
      flushCatalogues();
      fillRequiredFields();
      selectCategory('cat-1', []);

      submit();
      http
        .expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE))
        .flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
      await fixture.whenStable();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('still asks when the save failed', async () => {
      render();
      flushCatalogues();
      fillRequiredFields();
      selectCategory('cat-1', []);

      submit();
      http
        .expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE))
        .flush('', { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });
  });

  describe('edición', () => {
    beforeEach(() => {
      routeUuid = 'product-1';
    });

    it('prefills the form with the saved product, its prices and its branches', () => {
      render();
      flushCatalogues([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

      const page = fixture.componentInstance as unknown as {
        model: () => Record<string, unknown>;
      };

      expect(page.model()).toMatchObject({
        name: 'Válvula solenoide X-200',
        sku: 'ISV-X200',
        // Un producto anterior a la grilla sólo trae el campo único: es su fila principal.
        barcodes: [{ barcode: '779123456', isPrimary: true }],
        productType: 'SIMPLE',
        stockTracking: 'QUANTITY',
        expirationControl: 'NONE',
        unitMeasure: 'KILOGRAM',
        taxRate: 10.5,
        lowStock: 5,
        optimalStock: 40,
        isForSale: true,
        isForPurchase: false,
        brandUuid: 'brand-1',
        categoryUuid: 'cat-2',
        branchUuids: ['branch-1'],
        // Una fila por lista activa: la que el producto no tiene cargada queda sin precio, y el
        // precio final sale del neto guardado más el 10,5 % de alícuota del producto.
        prices: [
          { priceListUuid: 'list-retail', price: null, finalPrice: null },
          { priceListUuid: 'list-wholesale', price: 980, finalPrice: 1082.9 },
        ],
        attributes: [
          {
            attributeUuid: 'attr-color',
            name: 'Color',
            type: 'text',
            rawValue: 'Bronce pulido',
          },
        ],
      });
    });

    /**
     * El proveedor que no está entre las opciones se dibuja igual, con el nombre que trajo el
     * detalle: si se escondiera, guardar lo desvincularía sin que nadie lo haya pedido.
     */
    it('shows every linked supplier, including the one missing from the options', () => {
      render();
      flushCatalogues([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

      const page = fixture.componentInstance as unknown as {
        selectedSuppliers: () => readonly { uuid: string; name: string }[];
      };

      expect(page.selectedSuppliers()).toEqual([
        { uuid: 'supplier-1', name: 'Distribuidora Norte' },
        { uuid: 'supplier-legacy', name: 'Mayorista de siempre' },
      ]);
    });

    it('resends the supplier it could not list, instead of dropping it', async () => {
      render();
      flushCatalogues([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

      submit();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
      expect(request.request.body.suppliers).toEqual([
        { uuid: 'supplier-1' },
        { uuid: 'supplier-legacy' },
      ]);

      request.flush({ uuid: 'product-1', name: 'Válvula solenoide X-200' });
      await fixture.whenStable();
    });

    /**
     * Los atributos de la categoría llegan en una segunda request, después de la hidratación: si la
     * foto se tomara antes, toda edición avisaría de cambios que el usuario nunca hizo.
     */
    it('starts clean once the attributes of the saved category land', () => {
      render();
      flushCatalogues([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('posts the uuid so the backend treats the save as an edit', async () => {
      render();
      flushCatalogues([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

      submit();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
      expect(request.request.body).toMatchObject({
        uuid: 'product-1',
        name: 'Válvula solenoide X-200',
        category: { uuid: 'cat-2' },
        brand: { uuid: 'brand-1' },
        categoryAttributes: [{ attributeUuid: 'attr-color', value: 'Bronce pulido' }],
        priceListEntries: [{ priceListUuid: 'list-wholesale', price: 980 }],
        branches: [{ uuid: 'branch-1' }],
      });

      request.flush(PRODUCT);
      await fixture.whenStable();
    });

    /**
     * La versión viaja con el `uuid`: sin ella el backend rechaza con 409 toda edición de un
     * producto que ya se guardó alguna vez.
     */
    it('posts the version it read, so the backend can spot a concurrent edit', async () => {
      render();
      flushCatalogues([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

      submit();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
      expect(request.request.body.version).toBe(3);

      request.flush(PRODUCT);
      await fixture.whenStable();
    });

    it('keeps the product linked to branches the grid does not show', async () => {
      render();

      http.expectOne(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE)).flush({ content: BRANDS });
      http.expectOne(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE)).flush(CATEGORY_TREE);
      http.expectOne(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE)).flush({ content: PRICE_LISTS });
      // `branch-2` está desactivada, así que no entra en la grilla de sucursales.
      http.expectOne(apiUrl(API_ENDPOINTS.BRANCHES.PAGINATE)).flush({
        content: [BRANCHES[0], { ...BRANCHES[1], active: false }],
      });
      http.expectOne(apiUrl(API_ENDPOINTS.SUPPLIERS.PAGINATE)).flush({ content: SUPPLIERS });
      http.expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/product-1`)).flush({
        ...PRODUCT,
        branches: [
          { uuid: 'branch-1', name: 'Casa central' },
          { uuid: 'branch-2', name: 'Sucursal norte' },
        ],
      });
      flushPriceRule(null);
      http.expectOne(apiUrl(`${API_ENDPOINTS.CATEGORIES.ATTRIBUTES}/cat-2`)).flush([]);
      fixture.detectChanges();

      submit();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
      expect(request.request.body.branches).toEqual([{ uuid: 'branch-1' }, { uuid: 'branch-2' }]);

      request.flush(PRODUCT);
      await fixture.whenStable();
    });

    /**
     * El precio de una lista que recalcula la regla sale del costo de la sucursal: dejarlo editar
     * sería ofrecer un cambio que la próxima compra —o el propio guardado de la regla— desharía.
     */
    describe('precios que maneja una regla', () => {
      /** Las dos puntas se bloquean juntas: editar el final es editar el neto por la vía inversa. */
      it('disables only the lists the rule recalculates in the active branch', async () => {
        render();
        flushCatalogues([], PRICE_RULE);
        await openPricingTab();

        expect(priceRows()['Mayorista'].net.disabled).toBe(true);
        expect(priceRows()['Mayorista'].final.disabled).toBe(true);
        expect(priceRows()['Minorista'].net.disabled).toBe(false);
        expect(priceRows()['Minorista'].final.disabled).toBe(false);
      });

      it('keeps every price editable when no rule reaches the product', async () => {
        render();
        flushCatalogues([], null);
        await openPricingTab();

        expect(priceRows()['Mayorista'].net.disabled).toBe(false);
        expect(priceRows()['Mayorista'].final.disabled).toBe(false);
        expect(priceRows()['Minorista'].net.disabled).toBe(false);
      });

      /**
       * Reenviar el precio que la pantalla mostró lo persistiría como manual, y pisaría el que la
       * regla haya recalculado mientras el formulario estaba abierto.
       */
      it('leaves the rule-managed lists out of the payload', async () => {
        render();
        flushCatalogues([], PRICE_RULE);

        submit();

        const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
        // `list-wholesale` es la única con precio cargado, y es justo la que maneja la regla.
        expect(request.request.body.priceListEntries).toBeUndefined();

        request.flush(PRODUCT);
        await fixture.whenStable();
      });

      it('does not ask for the rule without the price_rule.view permission', () => {
        canViewPriceRules = false;
        render();
        flushCatalogues();

        http.expectNone(apiUrl(`${API_ENDPOINTS.PRICE_RULES.BY_PRODUCT}/product-1`));
      });
    });

    /**
     * Lo persistido es el neto; el final es el que ve el cliente, con la alícuota del producto
     * encima (`OrderItemBuilderService` arma así la línea de venta). Cada punta recalcula la otra.
     */
    describe('precio final con impuestos', () => {
      /** El producto tiene 980 en la mayorista y 10,5 % de alícuota. */
      const FINAL_WHOLESALE = 1082.9;

      it('previews the final price of the saved net price', async () => {
        render();
        flushCatalogues();
        await openPricingTab();

        expect(priceRows()['Mayorista'].final.value).toBe(String(FINAL_WHOLESALE));
        // Una lista sin precio tampoco tiene precio final: no es un cero.
        expect(priceRows()['Minorista'].final.value).toBe('');
      });

      it('recomputes the final price when the net one is edited', async () => {
        render();
        flushCatalogues();
        await openPricingTab();

        await type(priceRows()['Minorista'].net, '200');

        expect(priceRows()['Minorista'].final.value).toBe('221');
        // La punta que se está tipeando es la única que no se reescribe.
        expect(priceRows()['Minorista'].net.value).toBe('200');
      });

      it('recomputes the net price when the final one is edited', async () => {
        render();
        flushCatalogues();
        await openPricingTab();

        await type(priceRows()['Minorista'].final, '221');

        expect(priceRows()['Minorista'].net.value).toBe('200');
        expect(priceRows()['Minorista'].final.value).toBe('221');
      });

      it('moves every final price when the tax rate changes', async () => {
        render();
        flushCatalogues();

        const taxRateInput = fixture.nativeElement.querySelector(
          'input[aria-label="products.form.fields.taxRate"]',
        ) as HTMLInputElement;
        await type(taxRateInput, '0');
        await openPricingTab();

        // Sin impuesto el final es el neto: el que manda es el neto, que es lo que se guarda.
        expect(priceRows()['Mayorista'].final.value).toBe('980');
        expect(priceRows()['Mayorista'].net.value).toBe('980');
      });

      it('sends only the net price', async () => {
        // La navegación posterior al guardado queda fuera del test: su promesa vive más que el
        // fixture y el toast de su rechazo llegaría con el inyector ya destruido.
        vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

        render();
        flushCatalogues();
        await openPricingTab();

        await type(priceRows()['Minorista'].final, '121');
        submit();

        const request = http.expectOne(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
        expect(request.request.body.priceListEntries).toEqual([
          // 121 / 1,105: el neto que hay que guardar para que el cliente pague 121.
          { priceListUuid: 'list-retail', price: 109.5 },
          { priceListUuid: 'list-wholesale', price: 980 },
        ]);

        request.flush(PRODUCT);
        await fixture.whenStable();
      });
    });

    /**
     * El costo sale de la lista reservada Costo de la sucursal activa y es neto, igual que el
     * precio: comparar contra el precio final metería el IVA adentro de la ganancia.
     */
    describe('margen de ganancia', () => {
      it('reads the profit of each priced list against the branch cost', async () => {
        render();
        flushCatalogues();
        await openPricingTab();

        // 980 − 700 = 280 de ganancia: 28,6 % del precio y 40 % sobre el costo.
        expect(marginRows()).toEqual({
          Mayorista: { margin: '28.6 %', markup: '40 %' },
        });
      });

      it('recomputes while the price is being typed', async () => {
        render();
        flushCatalogues();
        await openPricingTab();

        await type(priceRows()['Minorista'].net, '875');

        // 875 − 700 = 175: 20 % del precio y 25 % sobre el costo.
        expect(marginRows()['Minorista']).toEqual({ margin: '20 %', markup: '25 %' });
      });

      /** Vender por debajo del costo no es un caso a esconder: es el que hay que ver. */
      it('reports a loss when the price falls below the cost', async () => {
        render();
        flushCatalogues();
        await openPricingTab();

        await type(priceRows()['Minorista'].net, '350');

        expect(marginRows()['Minorista']).toEqual({ margin: '-100 %', markup: '-50 %' });
      });

      it('explains itself instead of showing margins when the product has no cost yet', async () => {
        render();
        flushCatalogues();
        // Un producto que nunca entró por una compra no tiene costo en la sucursal.
        (fixture.componentInstance as unknown as { cost: { set(v: null): void } }).cost.set(null);
        await openPricingTab();

        expect(marginsSection().querySelector('.product-form__table')).toBeNull();
        expect(marginsSection().querySelector('.product-form__empty')).not.toBeNull();
      });
    });

    it('shows the error state instead of an empty form when the product cannot be loaded', () => {
      render();

      http.expectOne(apiUrl(API_ENDPOINTS.BRANDS.PAGINATE)).flush({ content: BRANDS });
      http.expectOne(apiUrl(API_ENDPOINTS.CATEGORIES.GET_ALL_TREE)).flush(CATEGORY_TREE);
      http.expectOne(apiUrl(API_ENDPOINTS.PRICE_LISTS.PAGINATE)).flush({ content: PRICE_LISTS });
      http.expectOne(apiUrl(API_ENDPOINTS.BRANCHES.PAGINATE)).flush({ content: BRANCHES });
      http
        .expectOne(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/product-1`))
        .flush('', { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(
        (fixture.componentInstance as unknown as { loadState: () => string }).loadState(),
      ).toBe('error');
      expect(fixture.nativeElement.querySelector('form input')).toBeNull();
    });
  });
  /**
   * La ficha de un producto **archivado**: salió del catálogo y no vuelve (ADR 0001).
   *
   * Se abre —es a donde lleva el indicador de un comprobante del histórico— y no se edita:
   * `POST /product/save` responde `400 PRODUCT_ARCHIVED_READ_ONLY`, así que lo que se verifica acá
   * es que la pantalla no ofrezca ningún camino que sólo pueda terminar en ese error.
   */
  describe('producto archivado', () => {
    beforeEach(() => {
      routeUuid = 'product-1';
      productDetail = { ...PRODUCT, status: -1 };
    });

    const page = (): HTMLElement => fixture.nativeElement as HTMLElement;

    it('dice por que no se edita, arriba y no en un tooltip', () => {
      render();
      flushCatalogues();

      const banner = page().querySelector('.product-form__archived-banner');
      expect(banner).not.toBeNull();
      // Con nombre accesible: un landmark sin nombre no se distingue del resto al navegar por
      // regiones, que es justamente cómo se lo va a encontrar.
      expect(banner?.getAttribute('aria-labelledby')).toBe('archived-title');
      expect(page().querySelector('#archived-title')?.textContent?.trim()).toBeTruthy();
    });

    it('no ofrece guardar', () => {
      render();
      flushCatalogues();

      // Se saca, no se deshabilita: un botón apagado invita a averiguar qué falta, y acá no falta
      // nada — la ficha es de consulta.
      expect(page().querySelector('button[type="submit"]')).toBeNull();
    });

    it('apaga los campos del formulario', () => {
      render();
      flushCatalogues();

      const inputs = Array.from(page().querySelectorAll('form input')) as HTMLInputElement[];
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.every((input) => input.disabled)).toBe(true);
    });

    it('no guarda aunque el formulario se envie con Enter', () => {
      render();
      flushCatalogues();

      submit();

      // Ni un `POST /product/save` en vuelo: el `afterEach` de `http.verify()` lo delataría.
      http.expectNone(apiUrl(API_ENDPOINTS.PRODUCTS.SAVE));
    });

    it('conserva la solapa Stock, en modo consulta', () => {
      // Sólo lectura es que no se escriba, no que se muestre menos: quien llega desde un comprobante
      // viejo puede querer ver dónde quedó ese saldo. El ajuste lo apaga la propia solapa.
      render();
      flushCatalogues();

      const labels = Array.from(page().querySelectorAll('[role="tab"]')).map((tab) =>
        tab.textContent?.trim(),
      );
      expect(labels).toContain('products.form.tabs.stock');
    });

    it('el producto vivo se sigue editando', () => {
      // El contraste que asegura que el modo de sólo lectura no se le aplicó a todo el catálogo.
      productDetail = PRODUCT;
      render();
      flushCatalogues();

      expect(page().querySelector('.product-form__archived-banner')).toBeNull();
      expect(page().querySelector('button[type="submit"]')).not.toBeNull();
      expect((page().querySelector('form input') as HTMLInputElement | null)?.disabled).toBe(false);
    });
  });
});
