import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
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
  PriceListFormDialogComponent,
  PriceListFormDialogData,
  PriceListFormDialogResult,
} from '../../components/price-list-form-dialog/price-list-form-dialog.component';
import {
  PRICE_LIST_CREATE_PERMISSION,
  PRICE_LIST_DELETE_PERMISSION,
  PRICE_LIST_EDIT_PERMISSION,
  PriceListDto,
  isSystemManaged,
} from '../../data-access/price-list.model';
import { PRODUCT_CATALOG_VIEW_PERMISSION } from '../../data-access/price-list-product.model';
import { PriceListsApiService } from '../../data-access/price-lists-api.service';
import { PRICE_LISTS_PATHS, priceListPricesPath } from '../../price-lists.paths';

/**
 * ABM de listas de precios de venta.
 *
 * La pantalla administra el encabezado de cada lista —nombre, si está habilitada y si es la
 * principal—. Los precios no se editan acá: son por producto y sucursal, y el backend sólo los
 * expone y los recibe desde el producto (`priceListEntries`) o desde una regla de precio, así que
 * el ABM de precios vive en el formulario de producto.
 */
@Component({
  selector: 'app-price-lists-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [PriceListsApiService],
  templateUrl: './price-lists.page.html',
  styleUrl: './price-lists.page.css',
})
export class PriceListsPage implements OnInit {
  private readonly priceListsApi = inject(PriceListsApiService);
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

  protected readonly canCreate = this.auth.hasPermission(PRICE_LIST_CREATE_PERMISSION);
  /** Marcar la lista principal es exclusivo de SysAdmin (`PriceListService.validatePrincipalChange`). */
  protected readonly canSetPrincipal = this.auth.isSysAdmin();

  /**
   * Los precios de la lista salen de `/product/paginate-all`, que exige `product.branch_assign`:
   * sin ese permiso la pantalla responde 403, así que la acción directamente no se ofrece.
   */
  private readonly canViewPrices = this.auth.hasPermission(PRODUCT_CATALOG_VIEW_PERMISSION);

  protected readonly paginator = new MatTablePaginator<PriceListDto>({
    fetchData: (query) => this.priceListsApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
    },
  });

  protected readonly displayedColumns = ['name', 'principal', 'active', 'actions'] as const;
  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly isSystemManaged = isSystemManaged;
  /**
   * La lista de costo no admite edición ni baja —el backend responde 403 en ambas— y tampoco tiene
   * precios que mirar: `paginate-all` la excluye de `priceListEntries`, así que su pantalla vendría
   * entera «sin precio». Se queda sin ninguna acción.
   */
  protected readonly noActions: readonly RowAction[] = [];

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];
    // Primero mirar, después administrar: «Ver precios» es a lo que se entra, no lo que se cambia.
    if (this.canViewPrices) {
      actions.push({
        id: 'viewPrices',
        icon: 'list_alt',
        label: this.translate.instant('priceLists.actions.viewPrices'),
      });
    }
    if (this.auth.hasPermission(PRICE_LIST_EDIT_PERMISSION)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('priceLists.actions.edit'),
      });
    }
    if (this.auth.hasPermission(PRICE_LIST_DELETE_PERMISSION)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('priceLists.actions.delete'),
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

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.priceLists', link: PRICE_LISTS_PATHS },
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

  protected onClearFilters(): void {
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  protected onCreate(): void {
    this.openFormDialog(null);
  }

  protected onRowAction(actionId: string, priceList: PriceListDto): void {
    if (actionId === 'viewPrices') {
      void this.router.navigate([priceListPricesPath(priceList.uuid)]);
      return;
    }

    if (actionId === 'edit') {
      this.openFormDialog(priceList);
      return;
    }

    if (actionId === 'delete') {
      this.deletePriceList(priceList);
    }
  }

  private openFormDialog(priceList: PriceListDto | null): void {
    const dialogRef = this.dialog.open<
      PriceListFormDialogComponent,
      PriceListFormDialogData,
      PriceListFormDialogResult
    >(PriceListFormDialogComponent, {
      width: '32rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { priceList, canSetPrincipal: this.canSetPrincipal },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is PriceListFormDialogResult => isPriceListFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<PriceListDto, PriceListDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) =>
              this.priceListsApi.save({
                uuid: result.uuid,
                name: result.name,
                isPrincipal: result.isPrincipal,
                isActive: result.isActive,
                version,
              }),
            fetchLatest: (uuid) => this.priceListsApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, priceList),
        error: (error: unknown) => {
          // La lista principal y la de costo responden 403 con el motivo exacto: es lo único que le
          // dice al usuario por qué no pudo guardar.
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('priceLists.toasts.saveError')),
          );
        },
      });
  }

  /**
   * `reloaded` es el usuario eligiendo descartar lo que había editado: se reabre el formulario con
   * la lista que hoy tiene el servidor, así no pierde el hilo de lo que estaba haciendo. El detalle
   * releído alcanza porque es el mismo encabezado que edita el diálogo —los precios no se tocan
   * acá—, y `canSetPrincipal` sale del permiso, no del registro.
   *
   * `cancelled` sólo llega si falló la recarga —el diálogo de conflicto no se puede descartar en
   * este patrón, porque el formulario ya se cerró—, y ese caso ya avisó por su cuenta.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<PriceListDto, PriceListDto>,
    priceList: PriceListDto | null,
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
      this.translate.instant(priceList ? 'priceLists.toasts.updated' : 'priceLists.toasts.created'),
    );
    this.paginator.refresh();
  }

  private deletePriceList(priceList: PriceListDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant(
          priceList.isPrincipal ? 'priceLists.confirmDeletePrincipal' : 'priceLists.confirmDelete',
          { name: priceList.name },
        ),
        confirmLabel: this.translate.instant('priceLists.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.priceListsApi.delete(priceList.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('priceLists.toasts.deleted'));
          // Borrar la última fila de la página deja la paginación fuera de rango: se retrocede a la
          // última página que sigue teniendo contenido antes de recargar.
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
            resolveApiErrorMessage(error, this.translate.instant('priceLists.toasts.deleteError')),
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

function isPriceListFormResult(value: unknown): value is PriceListFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const result = value as PriceListFormDialogResult;
  return typeof result.name === 'string' && result.name.trim().length > 0;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
