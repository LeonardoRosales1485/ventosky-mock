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
  BrandFormDialogComponent,
  BrandFormDialogResult,
} from '../../components/brand-form-dialog/brand-form-dialog.component';
import { BrandDto } from '../../data-access/brand.model';
import { BrandsApiService } from '../../data-access/brands-api.service';
import { BRANDS_PATHS } from '../../brands.paths';

@Component({
  selector: 'app-brands-page',
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
  providers: [BrandsApiService],
  templateUrl: './brands.page.html',
  styleUrl: './brands.page.css',
})
export class BrandsPage implements OnInit {
  private readonly brandsApi = inject(BrandsApiService);
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

  protected readonly paginator = new MatTablePaginator<BrandDto>({
    fetchData: (query) => this.brandsApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
    },
    filterConfig: {
      name: { tabla: 't', columna: 'name' },
    },
  });

  protected readonly displayedColumns = ['name', 'actions'] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  /** Local draft bound to the toolbar; flushed to the paginator after debounce. */
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    return [
      {
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('brands.actions.edit'),
      },
      {
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('brands.actions.delete'),
        color: 'warn',
      },
    ];
  });

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => {
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.brands', link: BRANDS_PATHS }];
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

  protected onRowAction(actionId: string, brand: BrandDto): void {
    if (actionId === 'edit') {
      this.openFormDialog(brand);
      return;
    }

    if (actionId === 'delete') {
      this.deleteBrand(brand);
    }
  }

  private openFormDialog(brand: BrandDto | null): void {
    const dialogRef = this.dialog.open<
      BrandFormDialogComponent,
      { brand: BrandDto | null },
      BrandFormDialogResult
    >(BrandFormDialogComponent, {
      width: '28rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { brand },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is BrandFormDialogResult => isBrandFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<BrandDto, BrandDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.brandsApi.save({
                uuid: result.uuid,
                name: result.name,
                version,
              }),
            fetchLatest: (uuid) => this.brandsApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, brand),
        error: () => {
          this.toast.error(this.translate.instant('brands.toasts.saveError'));
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * la marca que hoy tiene el servidor, así no pierde el hilo de lo que estaba haciendo.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<BrandDto, BrandDto>,
    brand: BrandDto | null,
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
      this.translate.instant(brand ? 'brands.toasts.updated' : 'brands.toasts.created'),
    );
    this.paginator.refresh();
  }

  private deleteBrand(brand: BrandDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('brands.confirmDelete', {
          name: brand.name,
        }),
        confirmLabel: this.translate.instant('brands.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.brandsApi.delete(brand.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('brands.toasts.deleted'));
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
          this.toast.error(this.translate.instant('brands.toasts.deleteError'));
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

function isBrandFormResult(value: unknown): value is BrandFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const brand = value as BrandFormDialogResult;
  return typeof brand.name === 'string' && brand.name.trim().length > 0;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
