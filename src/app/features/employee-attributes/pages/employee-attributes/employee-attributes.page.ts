import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
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
import { isAttributeValueType } from '../../../../core/attributes/attribute-value-type';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import {
  GuardedSaveOutcome,
  VersionConflictService,
} from '../../../../core/concurrency/version-conflict.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorData,
} from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
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
  EmployeeAttributeDraft,
  EmployeeAttributeFormDialogComponent,
  EmployeeAttributeFormDialogData,
  EmployeeAttributeFormDialogResult,
} from '../../components/employee-attribute-form-dialog/employee-attribute-form-dialog.component';
import { EmployeeAttributeDto } from '../../data-access/employee-attribute.model';
import { EmployeeAttributesApiService } from '../../data-access/employee-attributes-api.service';
import { EMPLOYEE_ATTRIBUTES_PATHS } from '../../employee-attributes.paths';

/**
 * Catálogo de campos extra de empleado: lo que cada empresa quiere llevar de sus empleados y el
 * sistema no trae —«talle de uniforme», «obra social»—.
 *
 * Acá sólo se definen el nombre y el tipo. Los valores se completan en la ficha de cada empleado,
 * que es donde se sabe de quién son; por eso borrar un campo avisa que se lleva esos valores.
 */
@Component({
  selector: 'app-employee-attributes-page',
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
  providers: [EmployeeAttributesApiService],
  templateUrl: './employee-attributes.page.html',
  styleUrl: './employee-attributes.page.css',
})
export class EmployeeAttributesPage implements OnInit {
  private readonly api = inject(EmployeeAttributesApiService);
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

  protected readonly paginator = new MatTablePaginator<EmployeeAttributeDto>({
    fetchData: (query) => this.api.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    // El tipo no se ordena: el orden sería el del código (`boolean`, `date`…), no el de la etiqueta
    // que se ve en la columna.
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
    },
    filterConfig: {
      name: { tabla: 't', columna: 'name' },
    },
  });

  protected readonly isKnownType = isAttributeValueType;

  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(Permissions.employeeAttributeCreate),
  );
  protected readonly canEdit = computed(() =>
    this.auth.hasPermission(Permissions.employeeAttributeEdit),
  );
  protected readonly canDelete = computed(() =>
    this.auth.hasPermission(Permissions.employeeAttributeDelete),
  );

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];
    if (this.canEdit()) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('employeeAttributes.actions.edit'),
      });
    }
    if (this.canDelete()) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('employeeAttributes.actions.delete'),
        color: 'warn',
      });
    }
    return actions;
  });

  /** Sin ninguna acción permitida, la columna de acciones no se dibuja: sería un menú vacío. */
  protected readonly displayedColumns = computed(() =>
    this.rowActions().length > 0 ? ['name', 'type', 'actions'] : ['name', 'type'],
  );

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.employeeAttributes', link: EMPLOYEE_ATTRIBUTES_PATHS },
    ]);
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

  protected onRowAction(actionId: string, attribute: EmployeeAttributeDto): void {
    if (actionId === 'edit') {
      this.openFormDialog(attribute);
      return;
    }

    if (actionId === 'delete') {
      this.deleteAttribute(attribute);
    }
  }

  private openFormDialog(
    attribute: EmployeeAttributeDto | null,
    draft?: EmployeeAttributeDraft,
  ): void {
    const dialogRef = this.dialog.open<
      EmployeeAttributeFormDialogComponent,
      EmployeeAttributeFormDialogData,
      EmployeeAttributeFormDialogResult
    >(EmployeeAttributeFormDialogComponent, {
      width: '28rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { attribute, draft },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is EmployeeAttributeFormDialogResult => isFormResult(result)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.save(result, attribute));
  }

  private save(
    result: EmployeeAttributeFormDialogResult,
    attribute: EmployeeAttributeDto | null,
  ): void {
    this.versionConflict
      .saveGuarded<EmployeeAttributeDto, EmployeeAttributeDto>({
        uuid: result.uuid,
        version: result.version,
        save: (version) =>
          this.api.save({ uuid: result.uuid, name: result.name, type: result.type, version }),
        fetchLatest: (uuid) => this.api.getByUuid(uuid),
        label: result.name,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, attribute),
        error: (error: unknown) => this.onSaveError(error, result, attribute),
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * el campo que hoy tiene el servidor. `cancelled` sólo llega si falló la recarga, que ya avisó.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<EmployeeAttributeDto, EmployeeAttributeDto>,
    attribute: EmployeeAttributeDto | null,
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
        attribute ? 'employeeAttributes.toasts.updated' : 'employeeAttributes.toasts.created',
      ),
    );
    this.paginator.refresh();
  }

  /**
   * Los dos rechazos que el usuario resuelve solo reabren el formulario con lo que había escrito,
   * para no hacérselo tipear de nuevo: el nombre repetido se corrige ahí mismo, y el tipo bloqueado
   * vuelve al que tenía el campo. El resto cae en el mensaje genérico.
   */
  private onSaveError(
    error: unknown,
    result: EmployeeAttributeFormDialogResult,
    attribute: EmployeeAttributeDto | null,
  ): void {
    if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_ATTRIBUTE_DUPLICATE)) {
      this.toast.error(
        this.translate.instant('employeeAttributes.toasts.duplicated', { name: result.name }),
      );
      this.openFormDialog(attribute, { name: result.name, type: result.type });
      return;
    }

    if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_ATTRIBUTE_TYPE_LOCKED)) {
      this.toast.error(
        this.translate.instant('employeeAttributes.toasts.typeLocked', {
          count: lockedValues(error),
        }),
      );
      const original = attribute?.type ?? '';
      this.openFormDialog(attribute, {
        name: result.name,
        type: isAttributeValueType(original) ? original : result.type,
      });
      return;
    }

    this.toast.error(this.translate.instant('employeeAttributes.toasts.saveError'));
  }

  private deleteAttribute(attribute: EmployeeAttributeDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('employeeAttributes.confirmDelete', {
          name: attribute.name,
        }),
        confirmLabel: this.translate.instant('employeeAttributes.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(attribute.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('employeeAttributes.toasts.deleted'));
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
          this.toast.error(this.translate.instant('employeeAttributes.toasts.deleteError'));
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

function isFormResult(value: unknown): value is EmployeeAttributeFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const result = value as EmployeeAttributeFormDialogResult;
  return (
    typeof result.name === 'string' &&
    result.name.trim().length > 0 &&
    isAttributeValueType(result.type)
  );
}

/** Cuántos empleados tienen completado el campo, según el `409` que rechazó el cambio de tipo. */
function lockedValues(error: unknown): number {
  const values = readApiErrorData(error)?.['values'];
  return typeof values === 'number' ? values : 0;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
