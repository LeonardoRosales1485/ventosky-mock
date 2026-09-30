import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { ALL_BRANCHES } from '../../../../core/http/branch-scope';
import { ToastService } from '../../../../core/notifications/toast.service';
import { ProductSerialDto, ProductSerialsDto } from '../../../../core/stock/stock-serial.model';
import { STOCK_VIEW_ALL_BRANCHES_PERMISSION } from '../../data-access/stock-adjustment.model';
import { SERIAL_ROW_LIMIT } from '../product-serials-panel/product-serials-panel.component';
import { ProductSerialsPanelComponent } from '../product-serials-panel/product-serials-panel.component';
import { ProductStockTabComponent } from './product-stock-tab.component';

describe('ProductStockTabComponent', () => {
  let fixture: ComponentFixture<ProductStockTabComponent>;
  let http: HttpTestingController;
  let canViewAllBranches: boolean;
  let dialogResult: unknown;
  /** Qué contesta el diálogo de confirmación de las acciones de postventa. */
  let confirmResult: boolean;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let toastError: ReturnType<typeof vi.fn>;
  let toastSuccess: ReturnType<typeof vi.fn>;

  const PRODUCT_UUID = 'product-1';

  const DISTRIBUTION = {
    product: { uuid: PRODUCT_UUID, name: 'Galaxy S23' },
    totalQuantity: 450,
    allBranches: true,
    rows: [
      {
        branch: { uuid: 'branch-1', name: 'Central' },
        warehouse: { uuid: 'wh-1', name: 'Depósito Principal' },
        quantity: 120,
        batchCount: 2,
      },
      {
        branch: { uuid: 'branch-2', name: 'Norte' },
        warehouse: { uuid: 'wh-2', name: 'Depósito General' },
        quantity: 330,
        batchCount: 1,
      },
    ],
  };

  const WAREHOUSES = [
    { uuid: 'wh-1', name: 'Depósito Principal', branch: { uuid: 'branch-1', name: 'Central' } },
    { uuid: 'wh-2', name: 'Depósito General', branch: { uuid: 'branch-2', name: 'Norte' } },
  ];

  const REASONS = [{ uuid: 'reason-1', name: 'Auditoría' }];

  /** Un campo del formulario, con lo justo para escribirlo desde el test. */
  type Field<T> = () => { value: { set(value: T): void } };

  /** Acceso a los miembros `protected` que la plantilla usa. */
  const tab = () =>
    fixture.componentInstance as unknown as {
      adjustmentForm: {
        branchUuid: Field<string | null>;
        warehouseUuid: Field<string | null>;
        adjustmentReasonUuid: Field<string | null>;
        countedQuantity: Field<number | null>;
        unitCost: Field<number | null>;
        reasonDescription: Field<string>;
      };
      onSubmit(): void;
    };

  /** El panel de series, que es quien lleva la grilla y las acciones de postventa. */
  const panel = () =>
    fixture.debugElement.query(By.directive(ProductSerialsPanelComponent))
      .componentInstance as unknown as { onReinstate(serial: ProductSerialDto): void };

  /** Monta la solapa y contesta sus tres lecturas iniciales. */
  const render = async (distribution = DISTRIBUTION): Promise<void> => {
    fixture = TestBed.createComponent(ProductStockTabComponent);
    fixture.componentRef.setInput('productUuid', PRODUCT_UUID);
    fixture.componentRef.setInput('productName', 'Galaxy S23');
    fixture.componentRef.setInput('unitDecimalPlaces', 0);
    fixture.detectChanges();

    http.expectOne(apiUrl(API_ENDPOINTS.STOCK.DISTRIBUTION(PRODUCT_UUID))).flush(distribution);
    http.expectOne(apiUrl(API_ENDPOINTS.WAREHOUSES.PAGINATE)).flush({ content: WAREHOUSES });
    http.expectOne(apiUrl(API_ENDPOINTS.ADJUSTMENT_REASONS.PAGINATE)).flush({ content: REASONS });

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Deja el formulario listo para guardar sobre el depósito indicado. */
  const fillAdjustment = async (warehouseUuid: string, counted: number): Promise<void> => {
    const form = tab().adjustmentForm;
    form.branchUuid().value.set(warehouseUuid === 'wh-1' ? 'branch-1' : 'branch-2');
    form.warehouseUuid().value.set(warehouseUuid);
    form.adjustmentReasonUuid().value.set('reason-1');
    form.countedQuantity().value.set(counted);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const save = async (): Promise<void> => {
    tab().onSubmit();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const adjustmentRequest = () => http.expectOne(apiUrl(API_ENDPOINTS.STOCK.ADJUSTMENT));

  /**
   * Deja resolver las promesas encadenadas del ajuste. El `412` recorre respuesta → popup →
   * reintento, y cada eslabón es un turno más del microtask queue: una sola vuelta no llega.
   */
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 3; turn += 1) {
      await fixture.whenStable();
    }
    fixture.detectChanges();
  };

  const distributionRequest = () =>
    http.expectOne(apiUrl(API_ENDPOINTS.STOCK.DISTRIBUTION(PRODUCT_UUID)));

  beforeEach(async () => {
    canViewAllBranches = true;
    dialogResult = undefined;
    confirmResult = true;
    dialogOpen = vi.fn(() => ({ afterClosed: () => of(dialogResult) }));
    toastError = vi.fn();
    toastSuccess = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ProductStockTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        // La grilla de series enlaza a la compra y a la consulta por serie.
        provideRouter([]),
        provideTranslateService(),
        {
          provide: AuthService,
          useValue: {
            hasPermission: (permission: string) =>
              permission === STOCK_VIEW_ALL_BRANCHES_PERMISSION ? canViewAllBranches : true,
            selectedBranchUuid: () => 'branch-1',
            selectedBranch: () => ({ uuid: 'branch-1', name: 'Central' }),
          },
        },
        { provide: MatDialog, useValue: { open: dialogOpen } },
        { provide: ConfirmDialogService, useValue: { confirm: () => of(confirmResult) } },
        { provide: ToastService, useValue: { success: toastSuccess, error: toastError } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('shows where the stock is, warehouse by warehouse', async () => {
    await render();

    const rows: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.product-stock__table tbody tr'),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Central');
    expect(rows[0].textContent).toContain('Depósito Principal');
    expect(rows[0].textContent).toContain('120');
    expect(
      fixture.nativeElement.querySelector('.product-stock__table tfoot').textContent,
    ).toContain('450');
  });

  /**
   * El contrato nuevo declara **cuánto hay**: la resta la hace el backend, y `expectedQuantity` es
   * el saldo que la pantalla tenía a la vista para que pueda detectar la venta del medio.
   */
  it('declares the counted quantity and the balance it read, not a delta', async () => {
    await render();
    await fillAdjustment('wh-2', 350);

    await save();

    const request = adjustmentRequest();
    expect(request.request.body).toEqual({
      product: { uuid: PRODUCT_UUID },
      warehouse: { uuid: 'wh-2' },
      countedQuantity: 350,
      expectedQuantity: 330,
      adjustmentReason: { uuid: 'reason-1' },
    });

    request.flush({
      adjustmentUuid: 'adj-1',
      product: { uuid: PRODUCT_UUID, name: 'Galaxy S23' },
      warehouse: { uuid: 'wh-2', name: 'Depósito General' },
      previousQuantity: 330,
      countedQuantity: 350,
      delta: 20,
      adjustmentType: 'INGRESO',
      adjustmentReason: { uuid: 'reason-1', name: 'Auditoría' },
      movementsCreated: 1,
    });
    await settle();

    // El ajuste aplicado deja la distribución vieja: se relee.
    distributionRequest().flush(DISTRIBUTION);
    expect(toastSuccess).toHaveBeenCalled();
  });

  /** Diferencia cero no genera movimientos: decir «ingresaron 0 unidades» sería mentir. */
  it('says nothing moved when the count confirms the balance', async () => {
    await render();
    await fillAdjustment('wh-2', 330);

    await save();

    adjustmentRequest().flush({
      adjustmentUuid: 'adj-1',
      product: { uuid: PRODUCT_UUID, name: 'Galaxy S23' },
      warehouse: { uuid: 'wh-2', name: 'Depósito General' },
      previousQuantity: 330,
      countedQuantity: 330,
      delta: 0,
      adjustmentType: 'INGRESO',
      adjustmentReason: { uuid: 'reason-1', name: 'Auditoría' },
      movementsCreated: 0,
    });
    await settle();

    distributionRequest().flush(DISTRIBUTION);
    expect(toastSuccess).toHaveBeenCalledWith('products.stockAdjustment.toasts.unchanged');
  });

  describe('reparto entre lotes (412)', () => {
    const BATCH_SELECTION_ERROR = {
      errorCode: 'ADJUSTMENT_BATCH_SELECTION_REQUIRED',
      userMessage: 'Selección de lotes requerida.',
      data: {
        direction: 'INGRESO',
        delta: 30,
        currentQuantity: 120,
        batches: [
          { uuid: 'batch-1', batchNumber: 'ADJ-1a2b', quantity: 80 },
          { uuid: 'batch-2', batchNumber: 'UNICO', quantity: 40 },
        ],
      },
    };

    /** El `412` no es una falla: es la pregunta que el mismo request contesta con un campo más. */
    it('asks for the split and retries the same payload with it', async () => {
      dialogResult = [{ stockBatch: { uuid: 'batch-1' }, quantity: 30 }];
      await render();
      await fillAdjustment('wh-1', 150);

      await save();

      adjustmentRequest().flush(BATCH_SELECTION_ERROR, {
        status: 412,
        statusText: 'Precondition Failed',
      });
      await settle();

      expect(dialogOpen).toHaveBeenCalled();

      const retry = adjustmentRequest();
      expect(retry.request.body).toEqual({
        product: { uuid: PRODUCT_UUID },
        warehouse: { uuid: 'wh-1' },
        countedQuantity: 150,
        expectedQuantity: 120,
        adjustmentReason: { uuid: 'reason-1' },
        batchAllocations: [{ stockBatch: { uuid: 'batch-1' }, quantity: 30 }],
      });

      retry.flush({
        adjustmentUuid: 'adj-1',
        product: { uuid: PRODUCT_UUID, name: 'Galaxy S23' },
        warehouse: { uuid: 'wh-1', name: 'Depósito Principal' },
        previousQuantity: 120,
        countedQuantity: 150,
        delta: 30,
        adjustmentType: 'INGRESO',
        adjustmentReason: { uuid: 'reason-1', name: 'Auditoría' },
        movementsCreated: 1,
      });
      await settle();

      distributionRequest().flush(DISTRIBUTION);
    });

    it('drops the adjustment when the split is cancelled', async () => {
      dialogResult = undefined;
      await render();
      await fillAdjustment('wh-1', 150);

      await save();

      adjustmentRequest().flush(BATCH_SELECTION_ERROR, {
        status: 412,
        statusText: 'Precondition Failed',
      });
      await settle();

      expect(dialogOpen).toHaveBeenCalled();
      // Sin reparto no hay reintento: `http.verify()` del `afterEach` lo comprueba.
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    /** El `batchCount` de la distribución anticipa el 412 antes de que el operador toque Guardar. */
    it('warns beforehand that the warehouse holds more than one batch', async () => {
      await render();
      await fillAdjustment('wh-1', 150);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'products.stockAdjustment.batchNotice',
      );
    });
  });

  /**
   * El `409` dice que el saldo leído ya no es el real. No se reintenta contra un número que el
   * operador no vio: se relee la distribución y vuelve a contar.
   */
  it('re-reads the distribution when the balance went stale', async () => {
    await render();
    await fillAdjustment('wh-2', 350);

    await save();

    adjustmentRequest().flush(
      {
        errorCode: 'ADJUSTMENT_STALE_QUANTITY',
        data: { expectedQuantity: 330, actualQuantity: 325 },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(toastError).toHaveBeenCalledWith('products.stockAdjustment.errors.stale');
    distributionRequest().flush(DISTRIBUTION);
    expect(dialogOpen).not.toHaveBeenCalled();
  });

  describe('alcance de la lectura', () => {
    /** Omitir `X-Branch-Uuid` es lo que el backend lee como «todas las sucursales». */
    it('reads every branch when the permission allows it', async () => {
      fixture = TestBed.createComponent(ProductStockTabComponent);
      fixture.componentRef.setInput('productUuid', PRODUCT_UUID);
      fixture.detectChanges();

      const distribution = http.expectOne(
        apiUrl(API_ENDPOINTS.STOCK.DISTRIBUTION(PRODUCT_UUID)),
      );
      const warehouses = http.expectOne(apiUrl(API_ENDPOINTS.WAREHOUSES.PAGINATE));

      expect(distribution.request.context.get(ALL_BRANCHES)).toBe(true);
      expect(warehouses.request.context.get(ALL_BRANCHES)).toBe(true);

      distribution.flush(DISTRIBUTION);
      warehouses.flush({ content: WAREHOUSES });
      http.expectOne(apiUrl(API_ENDPOINTS.ADJUSTMENT_REASONS.PAGINATE)).flush({ content: REASONS });
    });

    it('stays inside the active branch without the permission', async () => {
      canViewAllBranches = false;

      fixture = TestBed.createComponent(ProductStockTabComponent);
      fixture.componentRef.setInput('productUuid', PRODUCT_UUID);
      fixture.detectChanges();

      const distribution = http.expectOne(
        apiUrl(API_ENDPOINTS.STOCK.DISTRIBUTION(PRODUCT_UUID)),
      );
      expect(distribution.request.context.get(ALL_BRANCHES)).toBe(false);

      distribution.flush({ ...DISTRIBUTION, allBranches: false, rows: [DISTRIBUTION.rows[0]] });
      http.expectOne(apiUrl(API_ENDPOINTS.WAREHOUSES.PAGINATE)).flush({ content: [WAREHOUSES[0]] });
      http.expectOne(apiUrl(API_ENDPOINTS.ADJUSTMENT_REASONS.PAGINATE)).flush({ content: REASONS });
    });
  });

  describe('producto SERIAL (wireframe 1f)', () => {
    const WAREHOUSE = { uuid: 'wh-1', name: 'Depósito Principal' };
    const PURCHASE = { uuid: 'order-1', name: 'C-0117' };

    const SERIALS: ProductSerialsDto = {
      product: { uuid: PRODUCT_UUID, name: 'Notebook Aureo 14"' },
      productSku: 'NB-A14-16-512',
      allBranches: true,
      inStockCount: 2,
      soldCount: 1,
      returnedCount: 1,
      inTransitCount: 0,
      scrappedCount: 0,
      balanceQuantity: 2,
      consistent: true,
      rows: [
        {
          uuid: 's-41',
          serialNumber: 'SN-A14-0041',
          state: 'IN_STOCK',
          warehouse: WAREHOUSE,
          entryOrigin: PURCHASE,
        },
        {
          uuid: 's-42',
          serialNumber: 'SN-A14-0042',
          state: 'SOLD',
          entryOrigin: PURCHASE,
          exitOrigin: { uuid: 'order-2', name: 'V-8891' },
        },
        {
          uuid: 's-43',
          serialNumber: 'SN-A14-0043',
          state: 'IN_STOCK',
          warehouse: WAREHOUSE,
          entryOrigin: PURCHASE,
        },
        {
          uuid: 's-44',
          serialNumber: 'SN-A14-0044',
          state: 'RETURNED',
          warehouse: WAREHOUSE,
          entryOrigin: PURCHASE,
          exitOrigin: { uuid: 'order-3', name: 'V-8712' },
        },
      ],
    };

    const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

    const serialRows = (): HTMLElement[] =>
      Array.from(element().querySelectorAll('.product-serials__table tbody tr'));

    /**
     * Monta la solapa de un `SERIAL`. Son **dos** lecturas y no cuatro: sin ajuste en pantalla, los
     * depósitos y los motivos no se piden. `http.verify()` del `afterEach` lo comprueba.
     */
    const renderSerial = async (serials: ProductSerialsDto = SERIALS): Promise<void> => {
      fixture = TestBed.createComponent(ProductStockTabComponent);
      fixture.componentRef.setInput('productUuid', PRODUCT_UUID);
      fixture.componentRef.setInput('productName', 'Notebook Aureo 14"');
      fixture.componentRef.setInput('productModel', { uuid: 'model-1', name: 'Notebook Aureo 14"' });
      fixture.componentRef.setInput('stockTracking', 'SERIAL');
      fixture.componentRef.setInput('unitDecimalPlaces', 0);
      fixture.detectChanges();

      http.expectOne(apiUrl(API_ENDPOINTS.STOCK.DISTRIBUTION(PRODUCT_UUID))).flush(DISTRIBUTION);
      http.expectOne(apiUrl(API_ENDPOINTS.STOCK.SERIALS(PRODUCT_UUID))).flush(serials);
      http.expectNone(apiUrl(API_ENDPOINTS.WAREHOUSES.PAGINATE));
      http.expectNone(apiUrl(API_ENDPOINTS.ADJUSTMENT_REASONS.PAGINATE));

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    /**
     * La solapa de un `SERIAL` es la grilla, a todo el ancho: no hay dos columnas ni ajuste. Arranca
     * en «En stock», que es lo que se viene a mirar, con la invariante de §9 debajo aunque coincida.
     */
    it('is the grid of units, full width', async () => {
      await renderSerial();

      expect(element().querySelector('.product-stock__columns')).toBeNull();
      expect(element().querySelector('app-product-serials-panel')).not.toBeNull();
      expect(element().querySelector('#adjustment-title')).toBeNull();

      const rows = serialRows();
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain('SN-A14-0041');
      expect(rows[0].textContent).toContain('products.serials.entryOrder');
      expect(rows[1].textContent).toContain('SN-A14-0043');

      expect(element().textContent).toContain('products.serials.variantOf');
      expect(element().textContent).toContain('products.serials.consistencyOk');
    });

    /** Los contadores son el filtro: «Vendidas · 1» deja a la vista la vendida y con qué salió. */
    it('filters the grid by state from the counters', async () => {
      await renderSerial();

      const chips: HTMLButtonElement[] = Array.from(
        element().querySelectorAll('.product-serials__chip'),
      );
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
        'products.serials.states.IN_STOCK · 2',
        'products.serials.states.SOLD · 1',
        'products.serials.states.RETURNED · 1',
        'products.serials.states.IN_TRANSIT · 0',
        'products.serials.states.SCRAPPED · 0',
      ]);

      chips[1].click();
      fixture.detectChanges();

      const rows = serialRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('SN-A14-0042');
      expect(rows[0].textContent).toContain('products.serials.exitOrder');
    });

    /**
     * El ajuste manual **no existe** en un producto serializado, ni plegado ni detrás de un botón:
     * el saldo lo mueven las unidades, y un ajuste lo correría sin tocarlas.
     */
    it('offers no manual adjustment at all', async () => {
      await renderSerial();

      expect(element().querySelector('#adjustment-title')).toBeNull();
      expect(element().textContent).not.toContain('products.stockAdjustment.sections.details');
      expect(element().textContent).not.toContain('products.stockAdjustment.confirm');
    });

    /** «…N series más»: la grilla se pliega en el límite y se despliega con un click. */
    it('folds the grid past the row limit and unfolds it on demand', async () => {
      const rows: ProductSerialDto[] = Array.from(
        { length: SERIAL_ROW_LIMIT + 14 },
        (_, index) => ({
          uuid: `s-${index}`,
          serialNumber: `SN-${index}`,
          state: 'IN_STOCK' as const,
          warehouse: WAREHOUSE,
        }),
      );
      await renderSerial({
        ...SERIALS,
        inStockCount: rows.length,
        balanceQuantity: rows.length,
        rows,
      });

      // Las 50 visibles más el renglón de «…14 series más».
      expect(serialRows()).toHaveLength(SERIAL_ROW_LIMIT + 1);
      expect(element().textContent).toContain('products.serials.more');

      (element().querySelector('.product-serials__more-button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(serialRows()).toHaveLength(rows.length);
    });

    /**
     * Reingresar mueve el saldo, así que después de la acción se releen las unidades **y** la
     * distribución: es lo que mantiene el cartel de consistencia diciendo la verdad.
     */
    it('puts a returned unit back into stock and re-reads the balance', async () => {
      await renderSerial();

      panel().onReinstate(SERIALS.rows[3]);
      fixture.detectChanges();

      const request = http.expectOne(apiUrl(API_ENDPOINTS.STOCK.SERIAL_REINSTATE));
      expect(request.request.body).toEqual({ serialNumber: 'SN-A14-0044' });
      request.flush({
        uuid: 's-44',
        serialNumber: 'SN-A14-0044',
        state: 'IN_STOCK',
        product: { uuid: PRODUCT_UUID, name: 'Notebook Aureo 14"' },
      });
      fixture.detectChanges();

      distributionRequest().flush(DISTRIBUTION);
      http
        .expectOne(apiUrl(API_ENDPOINTS.STOCK.SERIALS(PRODUCT_UUID)))
        .flush({ ...SERIALS, inStockCount: 3, returnedCount: 0, balanceQuantity: 3 });
      fixture.detectChanges();

      expect(toastSuccess).toHaveBeenCalledWith('stock.serial.reinstateDone');
      expect(element().textContent).toContain('products.serials.states.IN_STOCK · 3');
    });

    /** Sin confirmar no pasa nada: ni request ni toast. `http.verify()` lo comprueba. */
    it('drops the action when it is not confirmed', async () => {
      confirmResult = false;
      await renderSerial();

      panel().onReinstate(SERIALS.rows[3]);
      fixture.detectChanges();

      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  /** En el alta no hay producto contra el cual mover inventario: no se lee nada. */
  it('reads nothing while the product has not been saved', () => {
    fixture = TestBed.createComponent(ProductStockTabComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('products.stockAdjustment.notSavedYet');
  });
});
