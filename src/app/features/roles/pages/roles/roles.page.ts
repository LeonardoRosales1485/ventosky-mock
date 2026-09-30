import {
  Component,
  DestroyRef,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  skip,
  switchMap,
} from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import {
  GuardedSaveOutcome,
  VersionConflictService,
} from '../../../../core/concurrency/version-conflict.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { MatTablePaginator } from '../../../../core/paginate';
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
  RoleFormDialogComponent,
  RoleFormDialogResult,
} from '../../components/role-form-dialog/role-form-dialog.component';
import { RoleDto } from '../../data-access/role.model';
import { RolesApiService } from '../../data-access/roles-api.service';
import { ROLES_PATHS } from '../../roles.paths';

@Component({
  selector: 'app-roles-page',
  imports: [
    LocalizedDatePipe,
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
  providers: [RolesApiService],
  templateUrl: './roles.page.html',
  styleUrl: './roles.page.css',
})
export class RolesPage implements OnInit {
  private readonly rolesApi = inject(RolesApiService);
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
  private readonly auth = inject(AuthService);

  protected readonly paginator = new MatTablePaginator<RoleDto>({
    fetchData: (query) => this.rolesApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      isDefault: { tabla: 't', columna: 'is_default' },
      dateCreated: { tabla: 't', columna: 'date_created' },
    },
    filterConfig: {
      name: { tabla: 't', columna: 'name' },
    },
  });

  protected readonly displayedColumns = [
    'name',
    'isDefault',
    'dateCreated',
    'actions',
  ] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  /**
   * Un administrador de empresa entra con `role.view` a ver los roles que puede asignar, pero no los
   * redacta: sin `role.create` / `role.edit` / `role.delete` la pantalla queda de lectura.
   */
  protected readonly canCreate = computed(() => this.auth.hasPermission(Permissions.roleCreate));

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(Permissions.roleEdit)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('roles.actions.edit'),
      });
    }

    if (this.auth.hasPermission(Permissions.roleDelete)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('roles.actions.delete'),
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
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.roles', link: ROLES_PATHS }];
    });
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    if (Object.keys(params).length > 0) {
      this.paginator.applyQueryParams(params);
    } else {
      this.paginator.load();
    }
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

  protected onRowAction(actionId: string, role: RoleDto): void {
    if (actionId === 'edit') {
      this.openEditDialog(role);
      return;
    }

    if (actionId === 'delete') {
      this.deleteRole(role);
    }
  }

  /** Paginate rows omit permissions — load the full DTO before editing. */
  private openEditDialog(role: RoleDto): void {
    this.rolesApi
      .getByUuid(role.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fullRole) => this.openFormDialog(fullRole),
        error: () => {
          this.toast.error(this.translate.instant('roles.toasts.loadError'));
        },
      });
  }

  private openFormDialog(role: RoleDto | null): void {
    const dialogRef = this.dialog.open<
      RoleFormDialogComponent,
      { role: RoleDto | null },
      RoleFormDialogResult
    >(RoleFormDialogComponent, {
      width: '32rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { role },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is RoleFormDialogResult => isRoleFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<RoleDto, RoleDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.rolesApi.save({
                uuid: result.uuid,
                name: result.name,
                isDefault: result.isDefault,
                permissions: result.permissions,
                version,
              }),
            fetchLatest: (uuid) => this.rolesApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, role),
        error: () => {
          this.toast.error(this.translate.instant('roles.toasts.saveError'));
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * el rol que hoy tiene el servidor. `latest` viene del mismo `getByUuid` que usa la edición, así
   * que ya trae los permisos y no hay que volver a pedirlo.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<RoleDto, RoleDto>,
    role: RoleDto | null,
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
      this.translate.instant(role ? 'roles.toasts.updated' : 'roles.toasts.created'),
    );
    this.paginator.refresh();
  }

  private deleteRole(role: RoleDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('roles.confirmDelete', {
          name: role.name,
        }),
        confirmLabel: this.translate.instant('roles.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.rolesApi.delete(role.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('roles.toasts.deleted'));
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
        error: () => {
          this.toast.error(this.translate.instant('roles.toasts.deleteError'));
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

function isRoleFormResult(value: unknown): value is RoleFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const role = value as RoleFormDialogResult;
  return typeof role.name === 'string' && role.name.trim().length > 0;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
