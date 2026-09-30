import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, filter, skip, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import {
  GuardedSaveOutcome,
  VersionConflictService,
} from '../../../../core/concurrency/version-conflict.service';
import { CashSessionService } from '../../../../core/cash-session/cash-session.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  FilterMatchMode,
  MatTablePaginator,
  PaginationFilterConstraint,
} from '../../../../core/paginate';
import { environment } from '../../../../../environments/environment';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  CashRegisterFormDialogComponent,
  CashRegisterFormDialogData,
  CashRegisterFormDialogResult,
} from '../../components/cash-register-form-dialog/cash-register-form-dialog.component';
import { CASH_REGISTERS_PATHS } from '../../cash-registers.paths';
import {
  CASH_REGISTER_CREATE_PERMISSION,
  CASH_REGISTER_DELETE_PERMISSION,
  CASH_REGISTER_EDIT_PERMISSION,
  CASH_REGISTER_OPEN_PERMISSION,
  CashRegisterDto,
  hasOpenSession,
} from '../../data-access/cash-register.model';
import { CashRegistersApiService } from '../../data-access/cash-registers-api.service';

/** Nombres que entran en la celda antes de resumir el resto en un «+N». */
const ASSIGNED_USERS_SHOWN = 2;

/**
 * ABM de cajas de la empresa.
 *
 * A diferencia del ABM de depósitos, `/cash-register/paginate` **no** se acota a la sucursal
 * activa: devuelve las cajas de toda la empresa, así que la grilla muestra la sucursal de cada una
 * y ofrece filtrar por ella. Desde acá también se gobierna la "caja preferencial" (`assignedUsers`),
 * que es lo que después resuelve `GET /cash-register/entry-context` al entrar al panel.
 */
@Component({
  selector: 'app-cash-registers-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [CashRegistersApiService],
  templateUrl: './cash-registers.page.html',
  styleUrl: './cash-registers.page.css',
})
export class CashRegistersPage implements OnInit {
  private readonly cashRegistersApi = inject(CashRegistersApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly cashSession = inject(CashSessionService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly paginator = new MatTablePaginator<CashRegisterDto>({
    fetchData: (query) => this.cashRegistersApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 't', columna: 'name' },
      { tabla: 'branches', columna: 'name' },
    ],
    // El JOIN sólo se emite cuando un filtro u orden nombra la tabla, así que declararlo no le
    // cuesta nada al listado sin filtrar.
    relaciones: [
      {
        tipo: 'left',
        desdeTabla: 't',
        desdeColumna: 'id_branch',
        hastaTabla: 'branches',
        hastaColumna: 'id',
      },
    ],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      branch: { tabla: 'branches', columna: 'name' },
      active: { tabla: 't', columna: 'active' },
    },
    filterConfig: {
      branch: { tabla: 'branches', columna: 'uuid' },
      active: { tabla: 't', columna: 'active' },
    },
  });

  protected readonly displayedColumns = [
    'name',
    'branch',
    'active',
    'session',
    'assignedUsers',
    'actions',
  ] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly branches = signal<readonly BranchDto[]>([]);
  protected readonly branchFilter = signal<string | null>(null);
  protected readonly activeFilter = signal<boolean | null>(null);
  protected readonly filtersOpen = signal(false);

  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(CASH_REGISTER_CREATE_PERMISSION),
  );

  protected readonly canOpen = computed(() =>
    this.auth.hasPermission(CASH_REGISTER_OPEN_PERMISSION),
  );

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(CASH_REGISTER_EDIT_PERMISSION)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('cashRegisters.actions.edit'),
      });
    }

    if (this.auth.hasPermission(CASH_REGISTER_DELETE_PERMISSION)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('cashRegisters.actions.delete'),
        color: 'warn',
      });
    }

    return actions;
  });

  /**
   * Las acciones de una fila. Se arman por fila y no una vez para toda la grilla porque abrir sólo
   * tiene sentido en una caja cerrada: ofrecerlo sobre una ya abierta sería ofrecer un 409.
   */
  protected rowActionsFor(cashRegister: CashRegisterDto): readonly RowAction[] {
    if (!this.canOpen() || this.isOpen(cashRegister)) {
      return this.rowActions();
    }

    return [
      {
        id: 'open',
        icon: 'lock_open',
        label: this.translate.instant('cashRegisters.actions.open'),
      },
      ...this.rowActions(),
    ];
  }

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => {
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.cashRegisters', link: CASH_REGISTERS_PATHS }];
    });
  }

  ngOnInit(): void {
    this.loadBranches();

    const params = this.route.snapshot.queryParams;
    if (Object.keys(params).length > 0) {
      this.paginator.applyQueryParams(params);
      this.restoreFilterSelection();
    } else {
      this.paginator.load();
    }
  }

  protected isOpen(cashRegister: CashRegisterDto): boolean {
    return hasOpenSession(cashRegister);
  }

  /**
   * Los primeros preasignados y cuántos quedan afuera: la lista entera desbordaría la celda y en
   * una caja compartida no aporta nada frente al tooltip.
   */
  protected assignedUsersLabel(cashRegister: CashRegisterDto): string {
    const users = cashRegister.assignedUsers ?? [];
    const shown = users.slice(0, ASSIGNED_USERS_SHOWN).map((user) => user.name);
    const hidden = users.length - shown.length;

    return hidden > 0 ? `${shown.join(', ')} +${hidden}` : shown.join(', ');
  }

  protected assignedUsersTooltip(cashRegister: CashRegisterDto): string {
    return (cashRegister.assignedUsers ?? []).map((user) => user.name).join(', ');
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

  protected onToggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onBranchFilterChange(uuid: string | null): void {
    this.branchFilter.set(uuid);
    this.applyFilters();
  }

  protected onActiveFilterChange(active: boolean | null): void {
    this.activeFilter.set(active);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.branchFilter.set(null);
    this.activeFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  protected onCreate(): void {
    this.openFormDialog(null);
  }

  protected onRowAction(actionId: string, cashRegister: CashRegisterDto): void {
    if (actionId === 'open') {
      this.openCashSession(cashRegister);
      return;
    }

    if (actionId === 'edit') {
      this.openFormDialog(cashRegister);
      return;
    }

    if (actionId === 'delete') {
      this.deleteCashRegister(cashRegister);
    }
  }

  /**
   * Abre la sesión de la caja y refresca la página.
   *
   * Se refresca también ante el `alreadyOpen`: ese 409 significa que la caja estaba abierta y el
   * listado no se había enterado, así que la fila que se ve está desactualizada de todos modos.
   */
  private openCashSession(cashRegister: CashRegisterDto): void {
    this.cashSession
      .open(cashRegister)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        if (outcome.kind !== 'none') {
          this.paginator.refresh();
        }
      });
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const branchUuid = this.branchFilter();
    if (branchUuid) {
      filters['branch'] = { value: branchUuid, matchMode: FilterMatchMode.Equals };
    }

    const active = this.activeFilter();
    if (active !== null) {
      filters['active'] = { value: active, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /** Re-hydrates the selects from the filters the paginator restored from the URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const branch = firstConstraint(filters['branch']);
    this.branchFilter.set(typeof branch?.value === 'string' ? branch.value : null);

    const active = firstConstraint(filters['active']);
    this.activeFilter.set(typeof active?.value === 'boolean' ? active.value : null);

    this.filtersOpen.set(this.branchFilter() !== null || this.activeFilter() !== null);
  }

  private loadBranches(): void {
    this.branchesApi
      .listAvailable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (branches) => this.branches.set(branches),
        error: () => this.toast.error(this.translate.instant('cashRegisters.toasts.branchesError')),
      });
  }

  private openFormDialog(cashRegister: CashRegisterDto | null): void {
    const dialogRef = this.dialog.open<
      CashRegisterFormDialogComponent,
      CashRegisterFormDialogData,
      CashRegisterFormDialogResult
    >(CashRegisterFormDialogComponent, {
      width: '32rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { cashRegister, defaultBranchUuid: this.branchFilter() },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is CashRegisterFormDialogResult =>
          isCashRegisterFormResult(result),
        ),
        switchMap((result) =>
          this.versionConflict.saveGuarded<CashRegisterDto, CashRegisterDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.cashRegistersApi.save({
                uuid: result.uuid,
                name: result.name,
                active: result.active,
                branch: { uuid: result.branchUuid },
                // Siempre explícita: omitirla dejaría las preasignaciones anteriores intactas y
                // quitar el último usuario no tendría efecto.
                assignedUsers: result.assignedUserUuids.map((uuid) => ({ uuid })),
                version,
              }),
            fetchLatest: (uuid) => this.cashRegistersApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, cashRegister),
        error: (error: unknown) => {
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('cashRegisters.toasts.saveError')),
          );
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * la caja que hoy tiene el servidor, así no pierde el hilo de lo que estaba haciendo.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<CashRegisterDto, CashRegisterDto>,
    cashRegister: CashRegisterDto | null,
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
      this.translate.instant(
        cashRegister ? 'cashRegisters.toasts.updated' : 'cashRegisters.toasts.created',
      ),
    );
    this.paginator.refresh();
  }

  private deleteCashRegister(cashRegister: CashRegisterDto): void {
    // Con sesión abierta el arqueo queda sin cerrar, así que la confirmación lo dice explícito.
    const messageKey = hasOpenSession(cashRegister)
      ? 'cashRegisters.confirmDeleteOpen'
      : 'cashRegisters.confirmDelete';

    this.confirmDialog
      .confirm({
        message: this.translate.instant(messageKey, { name: cashRegister.name }),
        confirmLabel: this.translate.instant('cashRegisters.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.cashRegistersApi.delete(cashRegister.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('cashRegisters.toasts.deleted'));
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
            resolveApiErrorMessage(
              error,
              this.translate.instant('cashRegisters.toasts.deleteError'),
            ),
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

function isCashRegisterFormResult(value: unknown): value is CashRegisterFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const result = value as CashRegisterFormDialogResult;
  return (
    typeof result.name === 'string' &&
    result.name.trim().length > 0 &&
    typeof result.branchUuid === 'string' &&
    result.branchUuid.length > 0 &&
    typeof result.active === 'boolean' &&
    Array.isArray(result.assignedUserUuids)
  );
}

function firstConstraint(
  value: PaginationFilterConstraint | PaginationFilterConstraint[] | undefined,
): PaginationFilterConstraint | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
