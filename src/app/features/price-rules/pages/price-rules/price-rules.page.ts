import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, filter, skip, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
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
  PRICE_RULE_CREATE_PERMISSION,
  PRICE_RULE_DELETE_PERMISSION,
  PRICE_RULE_EDIT_PERMISSION,
  PriceRuleDto,
  PriceRulePriceListDto,
  priceListRows,
  toPriceRounding,
} from '../../data-access/price-rule.model';
import { PriceRulesApiService } from '../../data-access/price-rules-api.service';
import {
  PRICE_RULES_NEW_PATH,
  PRICE_RULES_PATHS,
  priceRuleEditPath,
} from '../../price-rules.paths';

/**
 * Listado de reglas de precio.
 *
 * Cada fila muestra su grilla `lista @ sucursal — %`, que es lo que identifica el alcance de la
 * regla: el paginado del backend no puede filtrar por sucursal (la relación regla → listas es 1:N y
 * el SELECT no lleva `DISTINCT`), así que la grilla viaja completa en cada fila.
 */
@Component({
  selector: 'app-price-rules-page',
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
  providers: [PriceRulesApiService],
  templateUrl: './price-rules.page.html',
  styleUrl: './price-rules.page.css',
})
export class PriceRulesPage implements OnInit {
  private readonly priceRulesApi = inject(PriceRulesApiService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  protected readonly canCreate = this.auth.hasPermission(PRICE_RULE_CREATE_PERMISSION);

  protected readonly paginator = new MatTablePaginator<PriceRuleDto>({
    fetchData: (query) => this.priceRulesApi.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [{ tabla: 't', columna: 'name' }],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      ruleType: { tabla: 't', columna: 'rule_type' },
    },
  });

  protected readonly displayedColumns = [
    'name',
    'ruleType',
    'rounding',
    'scope',
    'actions',
  ] as const;
  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  protected readonly rowActions = computed<readonly RowAction[]>(() => {
    this.language.currentLang();

    const actions: RowAction[] = [];
    if (this.auth.hasPermission(PRICE_RULE_EDIT_PERMISSION)) {
      actions.push({
        id: 'edit',
        icon: 'edit',
        label: this.translate.instant('priceRules.actions.edit'),
      });
    }
    if (this.auth.hasPermission(PRICE_RULE_DELETE_PERMISSION)) {
      actions.push({
        id: 'delete',
        icon: 'delete_outline',
        label: this.translate.instant('priceRules.actions.delete'),
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
      { labelKey: 'nav.items.priceRules', link: PRICE_RULES_PATHS },
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

  protected readonly priceListRows = priceListRows;

  /** `Minorista · Centro — 50 %`, la fila de la grilla tal como se lee de un vistazo. */
  protected describeRow(row: PriceRulePriceListDto): string {
    return `${row.priceList?.name ?? ''} · ${row.branch?.name ?? ''} — ${formatPercent(row.percent)}`;
  }

  protected ruleTypeLabel(ruleType: string | null | undefined): string {
    return ruleType ? this.translate.instant(`priceRules.types.${ruleType}`) : '—';
  }

  /**
   * `Múltiplo de 10 · hacia arriba`. Desde `v74` el redondeo es de la regla y no de la sucursal, así
   * que dos filas del listado pueden declarar criterios distintos: se muestra para poder compararlas
   * sin abrir cada una.
   */
  protected roundingLabel(rule: PriceRuleDto): string {
    const rounding = toPriceRounding(rule.roundingMode, rule.roundingDirection);

    return [
      this.translate.instant(`priceRules.roundingModes.${rounding.mode}`),
      this.translate.instant(`priceRules.roundingDirections.${rounding.direction}`),
    ].join(' · ');
  }

  protected onCreate(): void {
    void this.router.navigate([PRICE_RULES_NEW_PATH]);
  }

  protected onRowAction(actionId: string, priceRule: PriceRuleDto): void {
    if (actionId === 'edit') {
      void this.router.navigate([priceRuleEditPath(priceRule.uuid)]);
      return;
    }

    if (actionId === 'delete') {
      this.deletePriceRule(priceRule);
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

  private deletePriceRule(priceRule: PriceRuleDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('priceRules.confirmDelete', { name: priceRule.name }),
        confirmLabel: this.translate.instant('priceRules.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.priceRulesApi.delete(priceRule.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('priceRules.toasts.deleted'));
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
        error: () => {
          this.toast.error(this.translate.instant('priceRules.toasts.deleteError'));
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

function formatPercent(percent: number | null | undefined): string {
  return percent === null || percent === undefined ? '—' : `${percent} %`;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
