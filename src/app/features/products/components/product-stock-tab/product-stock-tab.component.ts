import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { FormField, disabled, form, min, required, submit, validate } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { API_ERROR_CODES, hasApiErrorCode, resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  isQuantityPrecisionValid,
  quantityDecimalsOf,
  quantityStep,
  roundQuantity,
} from '../../../../core/product/quantity-precision';
import {
  ProductBatchDto,
  ProductBatchesDto,
  stockBatchTraceabilityPath,
} from '../../../../core/stock/stock-batch.model';
import { StockBatchesApiService } from '../../../../core/stock/stock-batches-api.service';
import { ProductSerialsDto } from '../../../../core/stock/stock-serial.model';
import { StockSerialsApiService } from '../../../../core/stock/stock-serials-api.service';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import { WarehousesApiService } from '../../../../core/warehouse/warehouses-api.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { ExpirationChipComponent } from '../../../../shared/components/expiration-chip/expiration-chip.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { ExpirationControl, StockTracking, UuidNameRef } from '../../data-access/product.model';
import {
  AdjustmentReasonDto,
  ProductStockDistributionDto,
  STOCK_ADJUSTMENT_PERMISSION,
  STOCK_VIEW_ALL_BRANCHES_PERMISSION,
  StockAdjustmentBatchAllocation,
  StockAdjustmentPayload,
  StockAdjustmentResponseDto,
} from '../../data-access/stock-adjustment.model';
import {
  StockAdjustmentsApiService,
  readBatchSelectionRequest,
  readErrorNumber,
} from '../../data-access/stock-adjustments-api.service';
import { ProductSerialsPanelComponent } from '../product-serials-panel/product-serials-panel.component';
import {
  BatchAllocationDialogComponent,
  BatchAllocationDialogData,
  BatchAllocationDialogResult,
} from '../batch-allocation-dialog/batch-allocation-dialog.component';

/** Sucursal ofrecida por el selector, derivada de los depósitos que devolvió el backend. */
interface BranchOption {
  uuid: string;
  name: string;
}

/**
 * Catálogo que el ajuste necesita y que está vacío. No es una falla: la lectura salió bien y
 * devolvió cero filas, así que lo que corresponde es decir qué falta crear, no ofrecer reintentar.
 */
type MissingCatalog = 'warehouses' | 'reasons';

/**
 * Con qué valor el selector de partida dice «una nueva». Es un centinela y no `null` porque
 * `mat-select` nunca matchea una opción de valor nulo, y la partida nueva es una opción más.
 */
export const NEW_BATCH = '__new__';

interface StockAdjustmentFormModel {
  branchUuid: string | null;
  warehouseUuid: string | null;
  adjustmentReasonUuid: string | null;
  /** Cuánto hay, no cuánto se mueve. El cero es válido: significa «no queda nada». */
  countedQuantity: number | null;
  /** Sólo viaja si la diferencia resulta un ingreso; en un egreso el backend lo ignora. */
  unitCost: number | null;
  reasonDescription: string;
  /**
   * Sólo con partidas: el uuid de la partida existente sobre la que se ajusta, o {@link NEW_BATCH}
   * para abrir una. `null` mientras no se eligió.
   */
  batchChoice: string | null;
  /** Número de la partida nueva. Sólo se lee con {@link NEW_BATCH}. */
  newBatchNumber: string;
  /** `yyyy-MM-dd`. Vencimiento de la partida nueva; obligatorio si el producto lo exige. */
  expirationDate: string | null;
}

/**
 * Stock del producto: dónde está y cómo se corrige.
 *
 * Es la pantalla del ajuste manual (`POST /stock/adjustment`) más el panel que le da contexto —la
 * distribución por depósito (`GET /stock/distribution/{uuid}`) o, en un producto con partidas, las
 * partidas con saldo y su semáforo de vencimiento (`GET /stock/batches/{uuid}`)—. El ajuste declara
 * **cuánto hay** en un depósito y el backend deduce el movimiento: la resta no la hace el front a
 * propósito, porque entre que la pantalla lee el saldo y llega el request puede haber pasado una
 * venta.
 *
 * La solapa **se ramifica por el eje** (§13.1): con `QUANTITY` es la de siempre; con `BATCH` el
 * ajuste además nombra la partida —una existente o una nueva, con su vencimiento— en el mismo
 * formulario, sin una pantalla aparte para «cargar el lote». Con `NONE` la solapa no existe.
 *
 * Con `SERIAL` la solapa **es la grilla de unidades** (wireframe `1f`): a todo el ancho, con el
 * buscador, los contadores por estado y la invariante de §9 a la vista. **No lleva ajuste manual**:
 * el saldo de un producto serializado lo mueven las unidades —la compra las carga, la venta las
 * saca— y un ajuste lo correría sin tocarlas, que es exactamente el descuadre que la invariante de
 * §9 existe para denunciar. El cartel lo dice cuando pasa; corregirlo es cargar o dar de baja
 * unidades, no escribir un número.
 *
 * Vive como solapa del formulario del producto y **no** anida un `<form>`: el formulario del
 * producto ya envuelve toda la página, así que los botones son `type="button"` y el ajuste se
 * confirma por su propio handler. Guardar el producto y ajustar su stock son dos operaciones
 * distintas contra dos endpoints distintos.
 */
@Component({
  selector: 'app-product-stock-tab',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    RouterLink,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    LoadStateComponent,
    CurrencyDisplayComponent,
    ExpirationChipComponent,
    ProductSerialsPanelComponent,
  ],
  templateUrl: './product-stock-tab.component.html',
  styleUrl: './product-stock-tab.component.css',
})
export class ProductStockTabComponent {
  private readonly stockApi = inject(StockAdjustmentsApiService);
  private readonly batchesApi = inject(StockBatchesApiService);
  private readonly serialsApi = inject(StockSerialsApiService);
  private readonly warehousesApi = inject(WarehousesApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);

  /** `null` mientras el producto no existe: en el alta todavía no hay stock que ajustar. */
  readonly productUuid = input<string | null>(null);
  readonly productName = input('');
  readonly productSku = input<string | null>(null);
  /**
   * El modelo del que el producto es variante, o `null` en un producto suelto. Un producto puede
   * ser `SERIAL` y variante a la vez (§15.5): el encabezado lo dice con un chip y la ficha no cambia.
   */
  readonly productModel = input<UuidNameRef | null>(null);
  /** Decimales que admite la unidad del producto; sale del formulario, que ya la tiene elegida. */
  readonly unitDecimalPlaces = input<number | null>(null);
  /** Eje de existencias del producto: decide si el ajuste nombra la partida. */
  readonly stockTracking = input<StockTracking>('QUANTITY');
  /** Si el vencimiento se pide, y con qué obligatoriedad, al abrir una partida. */
  readonly expirationControl = input<ExpirationControl>('NONE');

  /**
   * Solapa de consulta: la distribución, las partidas y las unidades se siguen viendo, pero no se
   * ofrece ajustar. Lo usa la ficha de un producto **archivado**, que se abre para mirar y no se
   * edita (ADR 0001) — y cuyo ajuste el backend rechazaría igual.
   *
   * Es una entrada y no otra consulta de permiso porque no habla de quién mira sino de qué producto
   * se está mirando: el mismo usuario ajusta sin problema el producto de al lado.
   */
  readonly readOnly = input(false);

  /**
   * `false` también en la ficha de consulta: son las dos razones por las que el ajuste no se ofrece,
   * y la grilla se comporta igual con las dos. Cuál de las dos es lo dice el mensaje del template.
   */
  protected readonly canAdjust = computed(
    () => this.auth.hasPermission(STOCK_ADJUSTMENT_PERMISSION) && !this.readOnly(),
  );
  /**
   * Con el permiso la pantalla lee toda la empresa (omitiendo `X-Branch-Uuid`) y el selector ofrece
   * las demás sucursales; sin él queda acotada a la sucursal activa del tab.
   */
  protected readonly canViewAllBranches = this.auth.hasPermission(
    STOCK_VIEW_ALL_BRANCHES_PERMISSION,
  );
  protected readonly isBatchTracked = computed(() => this.stockTracking() === 'BATCH');
  protected readonly isSerialTracked = computed(() => this.stockTracking() === 'SERIAL');
  protected readonly showsExpiration = computed(() => this.expirationControl() !== 'NONE');
  protected readonly expirationRequired = computed(() => this.expirationControl() === 'REQUIRED');

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly missingCatalog = signal<MissingCatalog | null>(null);
  protected readonly saving = signal(false);

  protected readonly distribution = signal<ProductStockDistributionDto | null>(null);
  /** Las partidas con saldo. Sólo se lee en un producto `BATCH`; en los demás queda en `null`. */
  protected readonly batches = signal<ProductBatchesDto | null>(null);
  /** Las unidades. Sólo se lee en un producto `SERIAL`; en los demás queda en `null`. */
  protected readonly serials = signal<ProductSerialsDto | null>(null);
  protected readonly warehouses = signal<readonly WarehouseDto[]>([]);
  protected readonly reasons = signal<readonly AdjustmentReasonDto[]>([]);

  protected readonly NEW_BATCH = NEW_BATCH;
  protected readonly batchPath = stockBatchTraceabilityPath;

  private readonly model = signal<StockAdjustmentFormModel>({
    branchUuid: null,
    warehouseUuid: null,
    adjustmentReasonUuid: null,
    countedQuantity: null,
    unitCost: null,
    reasonDescription: '',
    batchChoice: null,
    newBatchNumber: '',
    expirationDate: null,
  });

  /** Precisión con la que se puede contar, la que declara la unidad del producto. */
  private readonly quantityDecimals = computed(() =>
    quantityDecimalsOf({ unitDecimalPlaces: this.unitDecimalPlaces() }),
  );

  protected readonly step = computed(() => quantityStep(this.quantityDecimals()));

  protected readonly adjustmentForm = form(this.model, (path) => {
    required(path.warehouseUuid);
    required(path.adjustmentReasonUuid);

    required(path.countedQuantity);
    // El cero es una cantidad contada legítima —«no queda nada»—, así que el piso es 0 y no 1.
    min(path.countedQuantity, 0);
    validate(path.countedQuantity, ({ value }) => {
      const counted = value();
      if (counted === null) {
        return null; // `required` ya reporta el vacío.
      }

      const decimals = this.quantityDecimals();
      if (!isQuantityPrecisionValid(counted, decimals)) {
        return decimals === 0
          ? { kind: 'quantityInteger' }
          : { kind: 'quantityPrecision', decimals };
      }

      return null;
    });

    min(path.unitCost, 0);

    // Con partidas, el ajuste nombra sobre cuál se aplica; sin ellas estos campos no existen.
    validate(path.batchChoice, ({ value }) =>
      this.isBatchTracked() && !value() ? { kind: 'required' } : null,
    );
    validate(path.newBatchNumber, ({ value, valueOf }) =>
      this.isBatchTracked() && valueOf(path.batchChoice) === NEW_BATCH && !value().trim()
        ? { kind: 'required' }
        : null,
    );
    // Sobre una partida existente la fecha es la suya y no se toca: cambiarla sería otra partida.
    disabled(path.expirationDate, {
      when: ({ valueOf }) => !this.isBatchTracked() || valueOf(path.batchChoice) !== NEW_BATCH,
    });
    // RN-03: una partida nueva de un producto que exige vencimiento no se abre sin fecha.
    validate(path.expirationDate, ({ value, valueOf }) =>
      this.isBatchTracked() &&
      this.expirationRequired() &&
      valueOf(path.batchChoice) === NEW_BATCH &&
      !value()
        ? { kind: 'required' }
        : null,
    );
  });

  /** Las sucursales que tienen al menos un depósito, que son las únicas donde se puede ajustar. */
  protected readonly branchOptions = computed<BranchOption[]>(() => {
    const byUuid = new Map<string, BranchOption>();

    for (const warehouse of this.warehouses()) {
      const branch = warehouse.branch;
      if (branch) {
        byUuid.set(branch.uuid, { uuid: branch.uuid, name: branch.name });
      }
    }

    if (byUuid.size > 0) {
      return [...byUuid.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    // El backend no informó la sucursal de ningún depósito: se cae a la activa del tab, que es la
    // única que la lectura acotada pudo haber devuelto.
    const active = this.auth.selectedBranch();

    return active ? [{ uuid: active.uuid, name: active.name }] : [];
  });

  /** Los depósitos de la sucursal elegida. Sin sucursal elegida no se ofrece ninguno. */
  protected readonly warehouseOptions = computed(() => {
    const branchUuid = this.adjustmentForm.branchUuid().value();
    if (!branchUuid) {
      return [];
    }

    return this.warehouses().filter(
      // El depósito sin `branch` sólo puede ser de la sucursal activa: la lectura acotada no
      // devuelve otros.
      (warehouse) => (warehouse.branch?.uuid ?? branchUuid) === branchUuid,
    );
  });

  /** La fila de la distribución del depósito elegido, o `null` si ese depósito no tiene saldo. */
  private readonly selectedRow = computed(() => {
    const warehouseUuid = this.adjustmentForm.warehouseUuid().value();
    if (!warehouseUuid) {
      return null;
    }

    return (
      this.distribution()?.rows.find((row) => row.warehouse.uuid === warehouseUuid) ?? null
    );
  });

  /** Las partidas con saldo del depósito elegido: las que el ajuste puede nombrar. */
  protected readonly warehouseBatches = computed<readonly ProductBatchDto[]>(() => {
    const warehouseUuid = this.adjustmentForm.warehouseUuid().value();
    if (!warehouseUuid) {
      return [];
    }

    return (this.batches()?.rows ?? []).filter((row) => row.warehouse.uuid === warehouseUuid);
  });

  /** La partida existente elegida, o `null` con una nueva o sin elección. */
  protected readonly selectedBatch = computed<ProductBatchDto | null>(() => {
    const choice = this.adjustmentForm.batchChoice().value();
    if (!choice || choice === NEW_BATCH) {
      return null;
    }

    return this.warehouseBatches().find((batch) => batch.uuid === choice) ?? null;
  });

  protected readonly isNewBatch = computed(
    () => this.adjustmentForm.batchChoice().value() === NEW_BATCH,
  );

  /**
   * Saldo actual del depósito elegido. Un depósito que no figura en la distribución tiene cero: los
   * depósitos sin saldo no aparecen porque la distribución dice dónde **está** el stock.
   */
  protected readonly currentQuantity = computed(() => this.selectedRow()?.quantity ?? 0);

  /** Diferencia que va a aplicar el ajuste, con signo. `null` mientras no haya cantidad contada. */
  protected readonly delta = computed(() => {
    const counted = this.adjustmentForm.countedQuantity().value();
    if (counted === null) {
      return null;
    }

    return roundQuantity(counted - this.currentQuantity(), this.quantityDecimals());
  });

  /**
   * Si guardar va a disparar el `412` del reparto: más de un lote con saldo y ninguna partida
   * nombrada. Con partidas nombradas el backend no tiene nada que preguntar.
   */
  protected readonly willRequireBatchSelection = computed(() => {
    const delta = this.delta();

    return (
      !this.isBatchTracked() &&
      (this.selectedRow()?.batchCount ?? 0) > 1 &&
      delta !== null &&
      delta !== 0
    );
  });

  /** Sobre qué partida cae la diferencia, para decirlo antes de guardar. `null` sin elección. */
  protected readonly batchNoticeKey = computed<string | null>(() => {
    const delta = this.delta();
    if (!this.isBatchTracked() || delta === null || delta === 0) {
      return null;
    }

    if (this.isNewBatch()) {
      return delta > 0 ? 'products.stockAdjustment.batch.noticeNew' : null;
    }

    if (!this.selectedBatch()) {
      return null;
    }

    return delta > 0
      ? 'products.stockAdjustment.batch.noticeIn'
      : 'products.stockAdjustment.batch.noticeOut';
  });

  /** El costo sólo tiene efecto en un ingreso: se ofrece cuando la diferencia da positiva. */
  protected readonly showsUnitCost = computed(() => (this.delta() ?? 0) > 0);

  protected readonly emptyMessage = computed(() => {
    this.language.currentLang();

    const missing = this.missingCatalog();

    return missing ? this.translate.instant(`products.stockAdjustment.empty.${missing}`) : undefined;
  });

  protected readonly LoadState = LoadState;

  constructor() {
    // El producto se resuelve después de que la solapa se crea (la página lo lee por `uuid`), así
    // que la carga cuelga del input en vez del constructor.
    effect(() => {
      const productUuid = this.productUuid();
      if (productUuid) {
        this.load(productUuid);
      }
    });
  }

  protected onRetry(): void {
    const productUuid = this.productUuid();
    if (productUuid) {
      this.load(productUuid);
    }
  }

  protected onBranchChange(branchUuid: string): void {
    this.model.update((model) => ({
      ...model,
      branchUuid,
      // El depósito pertenece a una sucursal: cambiarla invalida el que estaba elegido, y con él la
      // partida, que es de un depósito.
      warehouseUuid: null,
      batchChoice: null,
    }));
  }

  protected onWarehouseChange(warehouseUuid: string): void {
    this.model.update((model) => ({ ...model, warehouseUuid, batchChoice: null }));
    this.adjustmentForm.warehouseUuid().markAsTouched();
  }

  /** Elegir una partida existente trae su vencimiento; elegir «nueva» deja la fecha para escribirla. */
  protected onBatchChoiceChange(choice: string): void {
    const chosen = this.warehouseBatches().find((batch) => batch.uuid === choice) ?? null;

    this.model.update((model) => ({
      ...model,
      batchChoice: choice,
      expirationDate: chosen ? (chosen.expirationDate ?? null) : null,
    }));
    this.adjustmentForm.batchChoice().markAsTouched();
  }

  /** Vuelve el formulario a su estado inicial sin tocar lo ya aplicado. */
  protected onReset(): void {
    this.adjustmentForm().reset();
    this.preselect();
  }

  protected onSubmit(): void {
    if (this.adjustmentForm().invalid()) {
      this.adjustmentForm().markAsTouched();
      return;
    }

    void submit(this.adjustmentForm, async () => {
      await this.applyAdjustment();
    });
  }

  /**
   * Una acción de postventa del panel de series terminó bien. El reingreso sube el saldo del lote y
   * la devolución cambia el estado de la unidad: las dos mitades de la invariante de §9 se releen
   * juntas para que el cartel siga diciendo la verdad.
   */
  protected onSerialsChanged(): void {
    const productUuid = this.productUuid();
    if (productUuid) {
      this.refreshStock(productUuid);
    }
  }

  private load(productUuid: string): void {
    this.loadState.set(LoadState.Loading);
    this.missingCatalog.set(null);

    forkJoin({
      distribution: this.stockApi
        .getDistribution(productUuid, this.canViewAllBranches)
        .pipe(catchError(() => of(null))),
      warehouses: this.loadWarehouses(),
      reasons: this.loadReasons(),
      batches: this.loadBatches(productUuid),
      serials: this.loadSerials(productUuid),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ distribution, warehouses, reasons, batches, serials }) => {
        // `null` es la lectura que falló —ahí sí tiene sentido reintentar—.
        if (
          distribution === null ||
          warehouses === null ||
          reasons === null ||
          batches === null ||
          serials === null
        ) {
          this.loadState.set(LoadState.Error);
          return;
        }

        this.distribution.set(distribution);
        this.warehouses.set(warehouses ?? []);
        this.reasons.set(reasons ?? []);
        this.batches.set(batches ?? null);
        this.serials.set(serials ?? null);

        // Un catálogo vacío se leyó bien: el ajuste igual es imposible, pero lo que falta es que
        // alguien cree el depósito o el motivo, así que se informa eso y no un error. Sin ajuste en
        // pantalla no hay nada que informar.
        if (warehouses && reasons && (warehouses.length === 0 || reasons.length === 0)) {
          this.missingCatalog.set(warehouses.length === 0 ? 'warehouses' : 'reasons');
        }

        this.preselect();
        this.loadState.set(LoadState.Success);
      });
  }

  /**
   * Los depósitos y los motivos son **del ajuste**, y un producto serializado no lo tiene: su saldo
   * lo mueven las unidades. Sin la pantalla que los usa, pedirlos es una lectura al cohete.
   */
  private loadWarehouses(): Observable<readonly WarehouseDto[] | null | undefined> {
    if (this.isSerialTracked()) {
      return of(undefined);
    }

    return this.warehousesApi.listAll(this.canViewAllBranches).pipe(catchError(() => of(null)));
  }

  private loadReasons(): Observable<readonly AdjustmentReasonDto[] | null | undefined> {
    if (this.isSerialTracked()) {
      return of(undefined);
    }

    return this.stockApi.getAdjustmentReasons().pipe(catchError(() => of(null)));
  }

  /**
   * Las partidas sólo se leen cuando el producto las lleva: `undefined` es «no aplica», que no
   * es lo mismo que `null` («la lectura falló»).
   */
  private loadBatches(productUuid: string): Observable<ProductBatchesDto | null | undefined> {
    if (!this.isBatchTracked()) {
      return of(undefined);
    }

    return this.batchesApi
      .getProductBatches(productUuid, this.canViewAllBranches)
      .pipe(catchError(() => of(null)));
  }

  /** Las unidades, con el mismo criterio: `undefined` es «no aplica», `null` es «falló». */
  private loadSerials(productUuid: string): Observable<ProductSerialsDto | null | undefined> {
    if (!this.isSerialTracked()) {
      return of(undefined);
    }

    return this.serialsApi
      .getProductSerials(productUuid, this.canViewAllBranches)
      .pipe(catchError(() => of(null)));
  }

  /** Refresca la distribución y las partidas: es lo único que cambia después de un ajuste. */
  private refreshStock(productUuid: string): void {
    this.stockApi
      .getDistribution(productUuid, this.canViewAllBranches)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((distribution) => {
        if (distribution) {
          this.distribution.set(distribution);
        }
      });

    if (this.isBatchTracked()) {
      this.batchesApi
        .getProductBatches(productUuid, this.canViewAllBranches)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((batches) => {
          if (batches) {
            this.batches.set(batches);
          }
        });
    }

    // El reingreso sube el saldo del lote y cambia el estado de la unidad: las dos mitades de la
    // invariante de §9 se releen juntas para que el cartel siga diciendo la verdad.
    if (this.isSerialTracked()) {
      this.serialsApi
        .getProductSerials(productUuid, this.canViewAllBranches)
        .pipe(
          catchError(() => of(null)),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((serials) => {
          if (serials) {
            this.serials.set(serials);
          }
        });
    }
  }

  /** La sucursal activa y —si es la única— su depósito: lo que no es una decisión no se pregunta. */
  private preselect(): void {
    const branches = this.branchOptions();
    const active = this.auth.selectedBranchUuid();
    const branchUuid =
      branches.find((branch) => branch.uuid === active)?.uuid ?? branches[0]?.uuid ?? null;

    if (!branchUuid) {
      return;
    }

    this.model.update((model) => ({ ...model, branchUuid }));

    const warehouses = this.warehouseOptions();
    if (warehouses.length === 1) {
      this.model.update((model) => ({ ...model, warehouseUuid: warehouses[0].uuid }));
    }
  }

  /**
   * Aplica el ajuste, contestando las dos preguntas que puede devolver el backend.
   *
   * El `412` pide el reparto entre lotes: se abre el popup y se **reintenta el mismo payload** con
   * `batchAllocations`, sin releer el saldo, porque `expectedQuantity` sigue siendo el que la
   * pantalla tenía a la vista. El `409` dice que ese saldo ya no es el real: ahí no se reintenta
   * nada, se refresca la distribución y el operador vuelve a contar contra el número nuevo.
   */
  private async applyAdjustment(allocations?: StockAdjustmentBatchAllocation[]): Promise<void> {
    const productUuid = this.productUuid();
    const model = this.model();
    if (!productUuid || !model.warehouseUuid || !model.adjustmentReasonUuid) {
      return;
    }

    const countedQuantity = model.countedQuantity;
    if (countedQuantity === null) {
      return;
    }

    const expectedQuantity = this.currentQuantity();
    const description = model.reasonDescription.trim();

    const payload: StockAdjustmentPayload = {
      product: { uuid: productUuid },
      warehouse: { uuid: model.warehouseUuid },
      countedQuantity,
      expectedQuantity,
      adjustmentReason: { uuid: model.adjustmentReasonUuid },
      ...(description ? { reasonDescription: description } : {}),
      // El costo sólo se manda si la diferencia da un ingreso; en un egreso el backend lo ignora,
      // pero mandarlo igual ensuciaría el request con un dato que no describe lo que pasó.
      ...(this.showsUnitCost() && model.unitCost !== null ? { unitCost: model.unitCost } : {}),
      ...this.batchIdentity(model),
      ...(allocations ? { batchAllocations: allocations } : {}),
    };

    this.saving.set(true);

    try {
      const result = await firstValueFrom(this.stockApi.adjust(payload));

      this.notifySuccess(result);
      this.refreshStock(productUuid);
      this.onReset();
    } catch (error: unknown) {
      await this.handleAdjustmentError(error, productUuid, allocations !== undefined);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * La partida sobre la que cae el ajuste de un producto con partidas (§7.2): la existente elegida
   * —número y vencimiento tal cual los tiene, para que el backend la reconozca— o la nueva.
   */
  private batchIdentity(model: StockAdjustmentFormModel): Partial<StockAdjustmentPayload> {
    if (!this.isBatchTracked()) {
      return {};
    }

    const existing = this.selectedBatch();
    if (existing) {
      return {
        batchNumber: existing.batchNumber ?? '',
        ...(existing.expirationDate ? { expirationDate: existing.expirationDate } : {}),
      };
    }

    return {
      batchNumber: model.newBatchNumber.trim(),
      ...(model.expirationDate ? { expirationDate: model.expirationDate } : {}),
    };
  }

  private async handleAdjustmentError(
    error: unknown,
    productUuid: string,
    wasRetry: boolean,
  ): Promise<void> {
    if (
      !wasRetry &&
      hasApiErrorCode(error, API_ERROR_CODES.ADJUSTMENT_BATCH_SELECTION_REQUIRED)
    ) {
      const allocations = await this.askForBatchAllocation(error);
      if (allocations) {
        await this.applyAdjustment(allocations);
      }
      return;
    }

    if (hasApiErrorCode(error, API_ERROR_CODES.ADJUSTMENT_STALE_QUANTITY)) {
      // El saldo cambió mientras la pantalla estaba abierta: se muestra el real y se relee, en vez
      // de reintentar contra un número que el operador no vio.
      const actual = readErrorNumber(error, 'actualQuantity');
      this.toast.error(
        this.translate.instant('products.stockAdjustment.errors.stale', {
          expected: readErrorNumber(error, 'expectedQuantity') ?? this.currentQuantity(),
          actual: actual ?? '—',
        }),
      );
      this.refreshStock(productUuid);
      return;
    }

    this.toast.error(
      resolveApiErrorMessage(error, this.translate.instant('products.toasts.stockAdjustError')),
    );
  }

  /** El popup del `412`. Devuelve `null` si el operador lo cerró sin repartir. */
  private async askForBatchAllocation(
    error: unknown,
  ): Promise<BatchAllocationDialogResult | null> {
    const selection = readBatchSelectionRequest(error);
    if (!selection) {
      // Un `412` sin lotes utilizables no se puede contestar con el popup: cae al mensaje del
      // backend, que al menos dice qué pasó.
      this.toast.error(
        resolveApiErrorMessage(error, this.translate.instant('products.toasts.stockAdjustError')),
      );
      return null;
    }

    const warehouseUuid = this.adjustmentForm.warehouseUuid().value();
    const warehouseName =
      this.warehouseOptions().find((warehouse) => warehouse.uuid === warehouseUuid)?.name ?? '';

    const dialogRef = this.dialog.open<
      BatchAllocationDialogComponent,
      BatchAllocationDialogData,
      BatchAllocationDialogResult
    >(BatchAllocationDialogComponent, {
      width: '40rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: {
        productName: this.productName(),
        warehouseName,
        direction: selection.direction,
        delta: selection.delta,
        currentQuantity: selection.currentQuantity,
        batches: selection.batches,
        unitDecimalPlaces: this.quantityDecimals(),
        batchTracked: this.isBatchTracked(),
        expirationRequired: this.expirationRequired(),
      },
    });

    return (await firstValueFrom(dialogRef.afterClosed())) ?? null;
  }

  private notifySuccess(result: StockAdjustmentResponseDto): void {
    // Diferencia cero no generó movimientos: decir «ingresaron 0 unidades» sería mentir sobre lo
    // que quedó en el kardex.
    if (result.movementsCreated === 0 || result.delta === 0) {
      this.toast.success(this.translate.instant('products.stockAdjustment.toasts.unchanged'));
      return;
    }

    this.toast.success(
      this.translate.instant(`products.toasts.stockAdjusted${result.adjustmentType}`, {
        name: result.product?.name ?? this.productName(),
        quantity: Math.abs(result.delta),
      }),
    );
  }
}
