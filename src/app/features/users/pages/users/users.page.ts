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
  UserFormDialogComponent,
  UserFormDialogResult,
} from '../../components/user-form-dialog/user-form-dialog.component';
import { UserDto } from '../../data-access/user.model';
import { UsersApiService } from '../../data-access/users-api.service';
import { USERS_PATHS } from '../../users.paths';

@Component({
  selector: 'app-users-page',
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
  providers: [UsersApiService],
  templateUrl: './users.page.html',
  styleUrl: './users.page.css',
})
export class UsersPage implements OnInit {
  private readonly usersApi = inject(UsersApiService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly paginator = new MatTablePaginator<UserDto>({
    fetchData: (query) => this.usersApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 't', columna: 'username' },
      { tabla: 't', columna: 'email' },
      { tabla: 't', columna: 'phone' },
    ],
    sortConfig: {
      username: { tabla: 't', columna: 'username' },
      email: { tabla: 't', columna: 'email' },
      phone: { tabla: 't', columna: 'phone' },
      dateCreated: { tabla: 't', columna: 'date_created' },
    },
    filterConfig: {
      username: { tabla: 't', columna: 'username' },
      email: { tabla: 't', columna: 'email' },
      phone: { tabla: 't', columna: 'phone' },
    },
  });

  protected readonly displayedColumns = [
    'username',
    'email',
    'phone',
    'dateCreated',
    'actions',
  ] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly canCreate = computed(() => this.auth.hasPermission(Permissions.userCreate));

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];

    if (this.auth.hasPermission(Permissions.userEdit)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('users.actions.edit'),
      });
    }

    if (this.auth.hasPermission(Permissions.userDelete)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('users.actions.delete'),
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
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.users', link: USERS_PATHS }];
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

  protected onRowAction(actionId: string, user: UserDto): void {
    if (actionId === 'edit') {
      this.openFormDialog(user);
      return;
    }

    if (actionId === 'delete') {
      this.deleteUser(user);
    }
  }

  private openFormDialog(user: UserDto | null): void {
    const companyUuid = this.auth.selectedCompanyUuid() ?? '';

    const dialogRef = this.dialog.open<
      UserFormDialogComponent,
      { user: UserDto | null; companyUuid: string },
      UserFormDialogResult
    >(UserFormDialogComponent, {
      width: '28rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { user, companyUuid },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is UserFormDialogResult => isUserFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<UserDto, UserDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.usersApi.save({
                uuid: result.uuid,
                username: result.username,
                email: result.email,
                phone: result.phone || null,
                password: result.password,
                userCompanyRoles: result.userCompanyRoles,
                version,
              }),
            fetchLatest: (uuid) => this.usersApi.getByUuid(uuid),
            label: result.username,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, user),
        error: () => {
          this.toast.error(this.translate.instant('users.toasts.saveError'));
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * el usuario que hoy tiene el servidor, así no pierde el hilo de lo que estaba haciendo.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<UserDto, UserDto>,
    user: UserDto | null,
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
      this.translate.instant(user ? 'users.toasts.updated' : 'users.toasts.created'),
    );
    this.paginator.refresh();
  }

  private deleteUser(user: UserDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('users.confirmDelete', {
          name: user.username,
        }),
        confirmLabel: this.translate.instant('users.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.usersApi.delete(user.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('users.toasts.deleted'));
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
          this.toast.error(this.translate.instant('users.toasts.deleteError'));
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

function isUserFormResult(value: unknown): value is UserFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const user = value as UserFormDialogResult;
  return (
    typeof user.username === 'string' &&
    user.username.trim().length > 0 &&
    typeof user.email === 'string' &&
    user.email.trim().length > 0
  );
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
