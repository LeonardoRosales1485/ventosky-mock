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
import {
  BRANCH_CREATE_PERMISSION,
  BRANCH_DELETE_PERMISSION,
  BRANCH_EDIT_PERMISSION,
  BranchDto,
} from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
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
import {
  BranchFormDialogComponent,
  BranchFormDialogResult,
} from '../../components/branch-form-dialog/branch-form-dialog.component';
import { BRANCHES_PATHS } from '../../branches.paths';

@Component({
  selector: 'app-branches-page',
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
  templateUrl: './branches.page.html',
  styleUrl: './branches.page.css',
})
export class BranchesPage implements OnInit {
  private readonly branchesApi = inject(BranchesApiService);
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

  protected readonly paginator = new MatTablePaginator<BranchDto>({
    fetchData: (query) => this.branchesApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      active: { tabla: 't', columna: 'active' },
    },
    filterConfig: {
      name: { tabla: 't', columna: 'name' },
    },
  });

  protected readonly displayedColumns = ['name', 'active', 'actions'] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(BRANCH_CREATE_PERMISSION),
  );

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(BRANCH_EDIT_PERMISSION)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('branches.actions.edit'),
      });
    }

    if (this.auth.hasPermission(BRANCH_DELETE_PERMISSION)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('branches.actions.delete'),
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
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.branches', link: BRANCHES_PATHS }];
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

  protected onRowAction(actionId: string, branch: BranchDto): void {
    if (actionId === 'edit') {
      this.openFormDialog(branch);
      return;
    }

    if (actionId === 'delete') {
      this.deleteBranch(branch);
    }
  }

  private openFormDialog(branch: BranchDto | null): void {
    const dialogRef = this.dialog.open<
      BranchFormDialogComponent,
      { branch: BranchDto | null },
      BranchFormDialogResult
    >(BranchFormDialogComponent, {
      width: '28rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { branch },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is BranchFormDialogResult => isBranchFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<BranchDto, BranchDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.branchesApi.save({
                uuid: result.uuid,
                name: result.name,
                active: result.active,
                address: result.address,
                version,
              }),
            fetchLatest: (uuid) => this.branchesApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, branch),
        error: () => {
          this.toast.error(this.translate.instant('branches.toasts.saveError'));
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * la sucursal que hoy tiene el servidor, así no pierde el hilo de lo que estaba haciendo.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<BranchDto, BranchDto>,
    branch: BranchDto | null,
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
      this.translate.instant(branch ? 'branches.toasts.updated' : 'branches.toasts.created'),
    );
    this.paginator.refresh();
  }

  private deleteBranch(branch: BranchDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('branches.confirmDelete', {
          name: branch.name,
        }),
        confirmLabel: this.translate.instant('branches.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.branchesApi.delete(branch.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('branches.toasts.deleted'));
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
          this.toast.error(this.translate.instant('branches.toasts.deleteError'));
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

function isBranchFormResult(value: unknown): value is BranchFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const branch = value as BranchFormDialogResult;
  return (
    typeof branch.name === 'string' &&
    branch.name.trim().length > 0 &&
    typeof branch.active === 'boolean'
  );
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
