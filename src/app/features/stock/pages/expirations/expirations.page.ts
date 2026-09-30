import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PickerCategoryOption } from '../../../../core/product-picker/product-picker.model';
import { StockBatchesApiService } from '../../../../core/stock/stock-batches-api.service';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import { WarehousesApiService } from '../../../../core/warehouse/warehouses-api.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { ExpirationChipComponent } from '../../../../shared/components/expiration-chip/expiration-chip.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { downloadCsv, toCsv } from '../../data-access/csv-export';
import {
  ExpirationFilters,
  ExpirationPageDto,
  ExpirationRange,
  ExpirationRowDto,
  ExpirationSummaryDto,
  STOCK_EXPIRATION_VIEW_PERMISSION,
  STOCK_VIEW_ALL_BRANCHES_PERMISSION,
} from '../../data-access/expiration.model';
import { ExpirationsApiService } from '../../data-access/expirations-api.service';
import { EXPIRATIONS_PATH, stockBatchTraceabilityPath } from '../../stock.paths';

/** Los cuatro botones del rango, en el orden del wireframe: lo urgente primero. */
type RangePreset = 'EXPIRED' | 'DUE_SOON' | 'ALERT' | 'ALL';

/** Ventana fija del preset «≤ 7 días», la misma que la tarjeta del medio. */
const DUE_SOON_DAYS = 7;

/**
 * El panel de vencimientos (§13.4, wireframe `1j`): lo que un rubro perecedero mira todos los días.
 *
 * Las tres tarjetas de arriba son la pantalla entera para el que la mira todos los días —cuánto hay
 * que sacar hoy y cuánto hay que rematar—; la grilla es el detalle, ordenada por vencimiento con
 * las vencidas primero y los días como número negativo, porque «−19» dice cuánto hace y se ordena.
 *
 * Dar de baja es una acción masiva sobre lo marcado que genera un **ajuste de egreso con motivo
 * `EXPIRED`**: queda en el kardex, no se borra. La barra lo dice antes del clic.
 */
@Component({
  selector: 'app-expirations-page',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink,
    TranslatePipe,
    CurrencyDisplayComponent,
    ExpirationChipComponent,
    PageHeaderComponent,
    TableWrapperComponent,
  ],
  providers: [ExpirationsApiService],
  templateUrl: './expirations.page.html',
  styleUrl: './expirations.page.css',
})
export class ExpirationsPage implements OnInit {
  private readonly api = inject(ExpirationsApiService);
  private readonly batchesApi = inject(StockBatchesApiService);
  private readonly warehousesApi = inject(WarehousesApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly canWriteOff = this.auth.hasPermission(STOCK_EXPIRATION_VIEW_PERMISSION);
  /** Con el permiso la lectura abarca toda la empresa y el filtro de sucursal tiene sentido. */
  protected readonly canViewAllBranches = this.auth.hasPermission(
    STOCK_VIEW_ALL_BRANCHES_PERMISSION,
  );

  protected readonly loading = signal(false);
  protected readonly writingOff = signal(false);
  protected readonly page = signal<ExpirationPageDto | null>(null);
  protected readonly summary = signal<ExpirationSummaryDto | null>(null);
  protected readonly loadError = signal(false);

  protected readonly branches = signal<readonly BranchDto[]>([]);
  protected readonly warehouses = signal<readonly WarehouseDto[]>([]);
  protected readonly categories = signal<readonly PickerCategoryOption[]>([]);

  protected readonly branchFilter = signal<string | null>(null);
  protected readonly warehouseFilter = signal<string | null>(null);
  protected readonly categoryFilter = signal<string | null>(null);
  protected readonly rangePreset = signal<RangePreset>('EXPIRED');
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(25);

  /** Las partidas marcadas para dar de baja, por uuid. Sobreviven al cambio de página. */
  protected readonly selection = signal<ReadonlySet<string>>(new Set());

  protected readonly pageSizeOptions = [10, 25, 50, 100];
  protected readonly displayedColumns = [
    'select',
    'product',
    'batch',
    'expiration',
    'days',
    'location',
    'quantity',
    'cost',
    'actions',
  ];
  protected readonly batchPath = stockBatchTraceabilityPath;
  protected readonly dueSoonDays = DUE_SOON_DAYS;

  protected readonly rows = computed(() => this.page()?.rows ?? []);
  protected readonly total = computed(() => this.page()?.total ?? 0);
  protected readonly alertDays = computed(() => this.page()?.alertDays ?? 30);

  /** Los depósitos de la sucursal filtrada; sin filtro, todos los del alcance. */
  protected readonly warehouseOptions = computed(() => {
    const branch = this.branchFilter();
    return branch
      ? this.warehouses().filter((warehouse) => (warehouse.branch?.uuid ?? branch) === branch)
      : this.warehouses();
  });

  protected readonly selectedCount = computed(() => this.selection().size);

  /** Cuántas unidades suman las marcadas **de esta página**: es lo que la barra puede sumar. */
  protected readonly selectedQuantity = computed(() =>
    this.rows()
      .filter((row) => this.selection().has(row.batchUuid))
      .reduce((total, row) => total + row.quantity, 0),
  );

  protected readonly allSelected = computed(
    () => this.rows().length > 0 && this.rows().every((row) => this.selection().has(row.batchUuid)),
  );

  protected readonly someSelected = computed(
    () => !this.allSelected() && this.rows().some((row) => this.selection().has(row.batchUuid)),
  );

  private readonly filters = computed<ExpirationFilters>(() => {
    const preset = this.rangePreset();
    const range: ExpirationRange =
      preset === 'EXPIRED' ? 'EXPIRED' : preset === 'ALL' ? 'ALL' : 'DAYS';

    return {
      branch: this.canViewAllBranches ? this.branchFilter() : null,
      warehouse: this.warehouseFilter(),
      category: this.categoryFilter(),
      range,
      days: preset === 'DUE_SOON' ? DUE_SOON_DAYS : preset === 'ALERT' ? null : undefined,
    };
  });

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stock', link: EXPIRATIONS_PATH },
    ]);

    // Cada cambio de filtro o de página relee la grilla; los filtros también releen las tarjetas.
    effect(() => {
      const filters = this.filters();
      const pageIndex = this.pageIndex();
      const pageSize = this.pageSize();
      untracked(() => this.load(filters, pageIndex, pageSize));
    });
  }

  ngOnInit(): void {
    this.loadCatalogs();
  }

  protected onBranchChange(uuid: string | null): void {
    this.branchFilter.set(uuid);
    // El depósito es de una sucursal: cambiarla invalida el que estaba elegido.
    this.warehouseFilter.set(null);
    this.pageIndex.set(0);
  }

  protected onWarehouseChange(uuid: string | null): void {
    this.warehouseFilter.set(uuid);
    this.pageIndex.set(0);
  }

  protected onCategoryChange(uuid: string | null): void {
    this.categoryFilter.set(uuid);
    this.pageIndex.set(0);
  }

  protected onRangeChange(preset: RangePreset): void {
    this.rangePreset.set(preset);
    this.pageIndex.set(0);
  }

  protected onPage(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  protected onRefresh(): void {
    this.load(this.filters(), this.pageIndex(), this.pageSize());
  }

  protected isSelected(row: ExpirationRowDto): boolean {
    return this.selection().has(row.batchUuid);
  }

  protected onToggle(row: ExpirationRowDto): void {
    this.selection.update((selected) => {
      const next = new Set(selected);
      if (!next.delete(row.batchUuid)) {
        next.add(row.batchUuid);
      }
      return next;
    });
  }

  /** Todo o nada sobre la página visible; lo marcado en otras páginas se conserva. */
  protected onToggleAll(): void {
    const uuids = this.rows().map((row) => row.batchUuid);
    this.selection.update((selected) => {
      const next = new Set(selected);
      if (this.allSelected()) {
        uuids.forEach((uuid) => next.delete(uuid));
      } else {
        uuids.forEach((uuid) => next.add(uuid));
      }
      return next;
    });
  }

  protected onClearSelection(): void {
    this.selection.set(new Set());
  }

  /**
   * La baja masiva: un ajuste de egreso por motivo `EXPIRED` sobre cada lote marcado, por su
   * saldo completo. Se confirma nombrando la consecuencia —queda en el kardex— porque es la única
   * acción de la pantalla que mueve stock.
   */
  protected onWriteOff(): void {
    const batchUuids = [...this.selection()];
    if (batchUuids.length === 0 || !this.canWriteOff) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('stock.expirations.writeOff.title'),
        message: this.translate.instant('stock.expirations.writeOff.message', {
          count: batchUuids.length,
        }),
        confirmLabel: this.translate.instant('stock.expirations.writeOff.confirm'),
        cancelLabel: this.translate.instant('stock.expirations.writeOff.cancel'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.writeOff(batchUuids);
        }
      });
  }

  /** Lo que la grilla tiene cargado, tal como se ve: una lista para llevar al depósito. */
  protected onExport(): void {
    const headers = [
      'product',
      'sku',
      'batch',
      'expiration',
      'days',
      'branch',
      'warehouse',
      'quantity',
      'unitCost',
      'totalCost',
    ].map((column) => this.translate.instant(`stock.expirations.export.${column}`));

    const csv = toCsv(
      headers,
      this.rows().map((row) => [
        row.product.name,
        row.productSku ?? '',
        row.batchNumber ?? '',
        row.expirationDate,
        row.daysToExpiration,
        row.branch?.name ?? '',
        row.warehouse.name,
        row.quantity,
        row.unitCost ?? '',
        row.totalCost ?? '',
      ]),
    );

    downloadCsv(`vencimientos-${this.page()?.today ?? 'hoy'}.csv`, csv);
  }

  protected onOpenBatch(row: ExpirationRowDto): void {
    void this.router.navigateByUrl(stockBatchTraceabilityPath(row.batchUuid));
  }

  private load(filters: ExpirationFilters, pageIndex: number, pageSize: number): void {
    this.loading.set(true);
    this.loadError.set(false);

    forkJoin({
      page: this.api.page(filters, pageIndex, pageSize, this.canViewAllBranches),
      summary: this.api.summary(filters, this.canViewAllBranches).pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ page, summary }) => {
          this.page.set(page);
          this.summary.set(summary);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(true);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stock.expirations.loadError')),
          );
        },
      });
  }

  private loadCatalogs(): void {
    forkJoin({
      warehouses: this.warehousesApi
        .listAll(this.canViewAllBranches)
        .pipe(catchError(() => of([] as WarehouseDto[]))),
      branches: this.canViewAllBranches
        ? this.branchesApi.listAll().pipe(catchError(() => of([] as BranchDto[])))
        : of([] as BranchDto[]),
      categories: this.api
        .getCategoryOptions()
        .pipe(catchError(() => of([] as PickerCategoryOption[]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ warehouses, branches, categories }) => {
        this.warehouses.set(warehouses);
        this.branches.set(branches);
        this.categories.set(categories);
      });
  }

  private writeOff(batchUuids: string[]): void {
    this.writingOff.set(true);

    this.batchesApi
      .writeOff({ batchUuids })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.writingOff.set(false);
          this.selection.set(new Set());
          this.toast.success(
            this.translate.instant('stock.expirations.writeOff.done', {
              count: result.movementsCreated,
              quantity: result.totalQuantity,
            }),
          );
          this.onRefresh();
        },
        error: (error: unknown) => {
          this.writingOff.set(false);
          this.toast.error(
            resolveApiErrorMessage(
              error,
              this.translate.instant('stock.expirations.writeOff.error'),
            ),
          );
        },
      });
  }
}
