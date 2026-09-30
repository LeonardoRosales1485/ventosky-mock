import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
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
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { todayIso } from '../../../../core/date/iso-date';
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
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  CIRCULATION_FILTER_KEY,
  PROMOTION_CIRCULATIONS,
  PROMOTION_CREATE_PERMISSION,
  PROMOTION_DELETE_PERMISSION,
  PROMOTION_EDIT_PERMISSION,
  PROMOTION_TYPES,
  typeOptionsFor,
  PromotionCirculation,
  PromotionDto,
  PromotionState,
  PromotionType,
  circulationFiltersOf,
  eligibleSetOf,
  isPromotionDimmed,
  promotionStateOf,
  promotionTypeChipOf,
  toPromotionFormValue,
  toPromotionSavePayload,
} from '../../data-access/promotion.model';
import { PromotionsApiService } from '../../data-access/promotions-api.service';
import { PROMOTIONS_NEW_PATH, PROMOTIONS_PATHS, promotionEditPath } from '../../promotions.paths';

/**
 * Listado de promociones.
 *
 * Contesta la pregunta operativa del día —*¿qué le estoy descontando a mis clientes?*— y para eso la
 * columna que manda es el **estado**, que no es una columna del backend: programada, vigente y
 * vencida las trae el calendario, y discontinuada el interruptor manual. Se deriva en
 * {@link promotionStateOf} contra el hoy del navegador.
 *
 * Las vencidas y las discontinuadas se dibujan **atenuadas pero no se esconden**: reactivar una
 * promoción que funcionó bien es justamente lo que se viene a hacer acá.
 */
@Component({
  selector: 'app-promotions-page',
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
    CurrencyDisplayComponent,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [PromotionsApiService],
  templateUrl: './promotions.page.html',
  styleUrl: './promotions.page.css',
})
export class PromotionsPage implements OnInit {
  private readonly promotionsApi = inject(PromotionsApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly canCreate = this.auth.hasPermission(PROMOTION_CREATE_PERMISSION);

  protected readonly circulations = PROMOTION_CIRCULATIONS;

  /**
   * El hoy contra el que se derivan los estados de la página. Se toma una vez por carga en vez de
   * leerlo en cada fila: así todas las filas de la tabla hablan de la misma fecha, y una sesión
   * abierta durante la medianoche no muestra media tabla de ayer y media de hoy.
   */
  protected readonly today = signal(todayIso());

  protected readonly paginator = new MatTablePaginator<PromotionDto>({
    fetchData: (query) => this.promotionsApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      type: { tabla: 't', columna: 'type' },
      // Con qué arranca cada una: es el orden que agrupa las programadas al final del calendario.
      validity: { tabla: 't', columna: 'valid_from' },
    },
    filterConfig: {
      type: { tabla: 't', columna: 'type' },
      [CIRCULATION_FILTER_KEY]: { tabla: 't', columna: 'is_discontinued' },
    },
  });

  protected readonly displayedColumns = [
    'name',
    'type',
    'eligibleSet',
    'audience',
    'payment',
    'validity',
    'state',
    'actions',
  ] as const;

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));

  protected readonly typeFilter = signal<PromotionType | null>(null);

  /**
   * Los tipos que el filtro ofrece: hoy sólo la porcentual (ver `ALL_PROMOTION_TYPES_ENABLED`).
   *
   * Depende del filtro puesto porque un link compartido puede traer un tipo que dejó de ofrecerse
   * —{@link restoreFilterSelection} lo valida contra la lista **completa**, a propósito—. Sin su
   * opción, el select abriría en blanco mientras la tabla sigue filtrada, que es la peor de las dos
   * cosas: filas que faltan y nada en pantalla que diga por qué.
   */
  protected readonly typeOptions = computed(() => typeOptionsFor(this.typeFilter()));
  protected readonly circulationFilter = signal<PromotionCirculation | null>(null);
  protected readonly filtersOpen = signal(false);

  /** Cuántos controles del panel están puestos, que es lo que el badge de la barra cuenta. */
  protected readonly activeFilters = computed(
    () => (this.typeFilter() ? 1 : 0) + (this.circulationFilter() ? 1 : 0),
  );

  /**
   * Lo que se puede hacer sobre la fila. Es un método y no un `computed` porque **depende de la
   * fila**: discontinuar y reactivar son la misma acción en los dos sentidos, y cuál se ofrece lo
   * decide el interruptor de esa promoción.
   */
  protected rowActionsFor(promotion: PromotionDto): readonly RowAction[] {
    this.language.currentLang();

    const actions: RowAction[] = [];
    const canEdit = this.auth.hasPermission(PROMOTION_EDIT_PERMISSION);

    if (canEdit) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('promotions.actions.edit'),
      });
      /*
       * **Discontinuar**, no «pausar» ni «desactivar»: las tres palabras nombran cosas distintas y
       * dos están prohibidas en el proyecto (ADR-0001). Apaga la promoción sin tocar sus fechas y se
       * deshace con este mismo botón, que es la razón de que viva en el listado y no sólo en el form.
       */
      actions.push(
        promotion.isDiscontinued === true
          ? {
              id: 'reactivate',
              icon: 'check_circle',
              label: this.translate.instant('promotions.actions.reactivate'),
            }
          : {
              id: 'discontinue',
              icon: 'block',
              label: this.translate.instant('promotions.actions.discontinue'),
            },
      );
    }

    /*
     * **Archivar**, no «eliminar»: retira la promoción del listado y no se deshace. Las ventas donde
     * se aplicó la siguen nombrando por su desglose persistido, así que el rastro no se pierde.
     */
    if (this.auth.hasPermission(PROMOTION_DELETE_PERMISSION)) {
      actions.push({
        id: 'archive',
        icon: 'archive',
        label: this.translate.instant('promotions.actions.archive'),
        color: 'warn',
      });
    }

    return actions;
  }

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.promotions', link: PROMOTIONS_PATHS },
    ]);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    if (Object.keys(params).length > 0) {
      this.paginator.applyQueryParams(params);
      this.restoreFilterSelection();
    } else {
      this.paginator.load();
    }
  }

  protected readonly promotionTypeChipOf = promotionTypeChipOf;
  protected readonly eligibleSetOf = eligibleSetOf;

  /**
   * El porcentaje con el separador decimal del idioma activo: una promoción de 10,5 % se lee `10,5 %`
   * en español y `10.5 %` en inglés. Sin esto el chip mostraba siempre el punto de JavaScript.
   */
  protected formatPercent(percent: number): string {
    return new Intl.NumberFormat(this.language.localeId(), {
      maximumFractionDigits: 2,
    }).format(percent);
  }

  protected stateOf(promotion: PromotionDto): PromotionState {
    return promotionStateOf(promotion, this.today());
  }

  /** Lo que ya no descuenta se atenúa; nunca se esconde, porque hay que poder reactivarlo. */
  protected isDimmed(promotion: PromotionDto): boolean {
    return isPromotionDimmed(this.stateOf(promotion));
  }

  protected onCreate(): void {
    void this.router.navigate([PROMOTIONS_NEW_PATH]);
  }

  protected onRowAction(actionId: string, promotion: PromotionDto): void {
    if (actionId === 'edit') {
      void this.router.navigate([promotionEditPath(promotion.uuid)]);
      return;
    }
    if (actionId === 'discontinue') {
      this.setDiscontinued(promotion, true);
      return;
    }
    if (actionId === 'reactivate') {
      this.setDiscontinued(promotion, false);
      return;
    }
    if (actionId === 'archive') {
      this.archivePromotion(promotion);
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
    // Un refresh que cruza la medianoche tiene que redibujar los estados con la fecha nueva.
    this.today.set(todayIso());
    this.paginator.refresh();
  }

  protected onToggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onTypeChange(type: PromotionType | null): void {
    this.typeFilter.set(type);
    this.applyFilters();
  }

  protected onCirculationChange(circulation: PromotionCirculation | null): void {
    this.circulationFilter.set(circulation);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.typeFilter.set(null);
    this.circulationFilter.set(null);
    this.applyFilters();
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {
      ...circulationFiltersOf(this.circulationFilter()),
    };

    const type = this.typeFilter();
    if (type) {
      filters['type'] = { value: type, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /**
   * Discontinuar y reactivar **no son endpoints**: son un guardado con `isDiscontinued` invertido, y
   * por eso no tocan las fechas ni pierden nada. La promoción se relee antes de guardar porque el
   * backend sincroniza sus cinco colecciones con lo que recibe: mandar el encabezado solo le borraría
   * el alcance en silencio. De la relectura sale además la versión, que es lo que evita pisar a otro.
   */
  private setDiscontinued(promotion: PromotionDto, isDiscontinued: boolean): void {
    this.promotionsApi
      .getByUuid(promotion.uuid)
      .pipe(
        switchMap((latest) =>
          this.promotionsApi.save(
            toPromotionSavePayload(
              { ...toPromotionFormValue(latest), isDiscontinued },
              latest.uuid,
              latest.version,
            ),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(
            this.translate.instant(
              isDiscontinued ? 'promotions.toasts.discontinued' : 'promotions.toasts.reactivated',
              { name: promotion.name },
            ),
          );
          this.paginator.refresh();
        },
        // El backend contesta con el código de la regla que falló, y ese mensaje es lo único que
        // explica el rechazo: `PROMOTION_DELETED` al tocar una archivada, o el 409 del bloqueo
        // optimista si alguien la editó entre la relectura y el guardado.
        error: (error: unknown) => {
          this.toast.error(
            resolveApiErrorMessage(
              error,
              this.translate.instant(
                isDiscontinued
                  ? 'promotions.toasts.discontinueError'
                  : 'promotions.toasts.reactivateError',
              ),
            ),
          );
        },
      });
  }

  private archivePromotion(promotion: PromotionDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('promotions.confirmArchive', { name: promotion.name }),
        confirmLabel: this.translate.instant('promotions.actions.archive'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.promotionsApi.archive(promotion.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('promotions.toasts.archived'));
          // Archivar la última fila de la página deja la paginación fuera de rango: se retrocede a
          // la última página que sigue teniendo contenido antes de recargar.
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
            resolveApiErrorMessage(error, this.translate.instant('promotions.toasts.archiveError')),
          );
        },
      });
  }

  /** Repuebla los selects con los filtros que el paginador restauró de la URL. */
  private restoreFilterSelection(): void {
    const filters = this.paginator.filters();

    const type = firstConstraint(filters['type'])?.value;
    this.typeFilter.set(PROMOTION_TYPES.find((option) => option === type) ?? null);

    const discontinued = firstConstraint(filters[CIRCULATION_FILTER_KEY])?.value;
    this.circulationFilter.set(
      discontinued === true ? 'discontinued' : discontinued === false ? 'notDiscontinued' : null,
    );

    // Con un filtro puesto el panel se abre solo: si no, el link compartido llega filtrado y sin
    // nada en pantalla que explique por qué faltan filas.
    this.filtersOpen.set(this.activeFilters() > 0);
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator.toQueryParams(),
      replaceUrl: true,
    });
  }
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
