import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, filter, skip, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  GuardedSaveOutcome,
  VersionConflictService,
} from '../../../../core/concurrency/version-conflict.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { MatTablePaginator } from '../../../../core/paginate';
import {
  WAREHOUSE_CREATE_PERMISSION,
  WAREHOUSE_DELETE_PERMISSION,
  WAREHOUSE_EDIT_PERMISSION,
  WarehouseDto,
} from '../../../../core/warehouse/warehouse.model';
import { WarehousesApiService } from '../../../../core/warehouse/warehouses-api.service';
import { environment } from '../../../../../environments/environment';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import {
  WarehouseFormDialogComponent,
  WarehouseFormDialogData,
  WarehouseFormDialogResult,
} from '../../components/warehouse-form-dialog/warehouse-form-dialog.component';
import { WAREHOUSES_PATHS } from '../../warehouses.paths';

/**
 * ABM de depósitos de la sucursal activa: el backend acota `/warehouse/paginate` al header
 * `X-Branch-Uuid` y le asigna esa misma sucursal a los que se crean acá, así que la pantalla no
 * tiene —ni necesita— un selector de sucursal.
 */
@Component({
  selector: 'app-warehouses-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    TranslatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  templateUrl: './warehouses.page.html',
  styleUrl: './warehouses.page.css',
})
export class WarehousesPage implements OnInit {
  private readonly warehousesApi = inject(WarehousesApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly paginator = new MatTablePaginator<WarehouseDto>({
    fetchData: (query) => this.warehousesApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      priority: { tabla: 't', columna: 'priority' },
    },
    filterConfig: {
      name: { tabla: 't', columna: 'name' },
    },
  });

  protected readonly displayedColumns = ['priority', 'name', 'actions'] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(WAREHOUSE_CREATE_PERMISSION),
  );

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(WAREHOUSE_EDIT_PERMISSION)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('warehouses.actions.edit'),
      });
    }

    if (this.auth.hasPermission(WAREHOUSE_DELETE_PERMISSION)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('warehouses.actions.delete'),
        color: 'warn',
      });
    }

    return actions;
  });

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => {
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.warehouses', link: WAREHOUSES_PATHS }];
    });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    if (Object.keys(params).length > 0) {
      this.paginator.applyQueryParams(params);
      return;
    }

    // Arranca ordenado por prioridad: así la grilla se lee como el orden en que la sucursal
    // descuenta el stock, que es lo que la columna significa.
    this.paginator.handleSortChange({ active: 'priority', direction: 'asc' });
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
    void this.syncQueryParams();
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
    void this.syncQueryParams();
  }

  protected onRefresh(): void {
    this.paginator.refresh();
  }

  protected onFiltersClick(): void {
    // Column filters panel can plug into paginator.setFilters(...) later.
  }

  protected onClearFilters(): void {
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  protected onCreate(): void {
    this.openFormDialog(null);
  }

  protected onRowAction(actionId: string, warehouse: WarehouseDto): void {
    if (actionId === 'edit') {
      this.openFormDialog(warehouse);
      return;
    }

    if (actionId === 'delete') {
      this.deleteWarehouse(warehouse);
    }
  }

  private openFormDialog(warehouse: WarehouseDto | null): void {
    const dialogRef = this.dialog.open<
      WarehouseFormDialogComponent,
      WarehouseFormDialogData,
      WarehouseFormDialogResult
    >(WarehouseFormDialogComponent, {
      width: '28rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { warehouse },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is WarehouseFormDialogResult => isWarehouseFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<WarehouseDto, WarehouseDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.warehousesApi.save({
                uuid: result.uuid,
                name: result.name,
                priority: result.priority,
                version,
              }),
            fetchLatest: (uuid) => this.warehousesApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, warehouse),
        error: (error: unknown) => {
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('warehouses.toasts.saveError')),
          );
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * el depósito que hoy tiene el servidor, así no pierde el hilo de lo que estaba haciendo.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<WarehouseDto, WarehouseDto>,
    warehouse: WarehouseDto | null,
  ): void {
    if (outcome.kind === 'cancelled') {
      return;
    }

    if (outcome.kind === 'reloaded') {
      this.toast.info(this.translate.instant('versionConflict.reloaded'));
      this.paginator.refresh();
      this.openFormDialog(outcome.latest);
      return;
    }

    this.toast.success(
      this.translate.instant(warehouse ? 'warehouses.toasts.updated' : 'warehouses.toasts.created'),
    );
    this.paginator.refresh();
  }

  private deleteWarehouse(warehouse: WarehouseDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('warehouses.confirmDelete', {
          name: warehouse.name,
        }),
        confirmLabel: this.translate.instant('warehouses.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.warehousesApi.delete(warehouse.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('warehouses.toasts.deleted'));
          // Al borrar el último de la página hay que retroceder, o la grilla queda vacía.
          const nextTotal = this.paginator.totalCount() - 1;
          const pageSize = this.paginator.pageSize();
          const lastPageIndex = Math.max(0, Math.ceil(nextTotal / pageSize) - 1);
          const pageIndex = Math.min(this.paginator.pageIndex(), lastPageIndex);
          this.paginator.handlePaginateEvent({
            ...this.paginator.getCurrentEvent(),
            pageIndex,
          });
          void this.syncQueryParams();
        },
        error: (error: unknown) => {
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('warehouses.toasts.deleteError')),
          );
        },
      });
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator.toQueryParams(),
      replaceUrl: true,
    });
  }
}

function isWarehouseFormResult(value: unknown): value is WarehouseFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const warehouse = value as WarehouseFormDialogResult;
  return typeof warehouse.name === 'string' && warehouse.name.trim().length > 0;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
