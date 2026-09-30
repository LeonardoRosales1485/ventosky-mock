import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { DelinquencyChipComponent } from '../../../../core/checking-accounts/delinquency-chip/delinquency-chip.component';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { FilterMatchMode, MatTablePaginator } from '../../../../core/paginate';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import {
  CHECKING_ACCOUNTS_PATH,
  CHECKING_ACCOUNT_POLICY_PATH,
  checkingAccountPath,
  newCollectionForAccountPath,
} from '../../checking-accounts.paths';
import { CheckingAccountRowDto, PartyRole } from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

/**
 * El listado de cuentas corrientes: una cuenta por rol de tercero, con lo que hace falta para
 * decidir a quién llamar hoy.
 *
 * **Cuatro de las seis columnas no son columnas de la tabla.** Titular y documento viven en
 * `parties`, el rol en `party_roles`, y el vencido se calcula contra la fecha de hoy en cada
 * lectura. Se piden igual, por su nombre, y el backend las traduce.
 *
 * **«Vencido» no lleva encabezado ordenable**, y es lo único que distingue a esa columna de las
 * demás: se resuelve después de la consulta, así que un `ORDER BY` ordenaría sólo la página que ya
 * vino. Un encabezado que promete un orden y devuelve otro es peor que uno que no se puede tocar.
 *
 * **El disponible no está acá.** Sale de `/availability`, que resuelve la decisión del portón para
 * una operación y un importe concretos; en el paginado no viaja, y su lugar es el panel del titular
 * en el mostrador.
 *
 * **El saldo se lee con el rol, no con el signo** (§3.1). En una cuenta `CUSTOMER` un saldo positivo
 * es «el cliente nos debe»; en una `SUPPLIER`, «le debemos». La aritmética es la misma en las dos
 * mitades y un saldo negativo es siempre saldo a favor del titular — la fila lo dice con palabras en
 * vez de dejar que el menos lo insinúe.
 *
 * **No hay acción de compensar.** Las dos cuentas de un tercero no se netean, ni automática ni
 * manualmente (§8.5): no existe la operación, ni el endpoint, ni el permiso.
 */
@Component({
  selector: 'app-checking-accounts-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink,
    TranslatePipe,
    CurrencyDisplayComponent,
    DelinquencyChipComponent,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  templateUrl: './checking-accounts.page.html',
  styleUrl: './checking-accounts.page.css',
})
export class CheckingAccountsPage implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * Cuatro de las columnas que este paginador nombra no existen en `checking_accounts`: `name` y
   * `docNumber` viven en `parties`, `role` en `party_roles`, y `hasOverdue` se deriva de los
   * vencimientos del día. Se piden igual, por su nombre, y el backend las traduce — la pantalla no
   * sabe ni tiene por qué saber dónde están.
   *
   * `overdueAmount` está en la tabla pero **no** en `sortConfig`, y es a propósito: el backend lo
   * calcula después de la consulta, así que ordenar por él ordenaría sólo dentro de la página.
   */
  protected readonly paginator = new MatTablePaginator<CheckingAccountRowDto>({
    fetchData: (query) => this.api.paginateAccounts(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 't', columna: 'name' },
      { tabla: 't', columna: 'docNumber' },
    ],
    sortConfig: {
      name: { tabla: 't', columna: 'name' },
      docNumber: { tabla: 't', columna: 'docNumber' },
      role: { tabla: 't', columna: 'role' },
      balance: { tabla: 't', columna: 'balance' },
    },
    filterConfig: {
      role: { tabla: 't', columna: 'role' },
      hasOverdue: { tabla: 't', columna: 'hasOverdue' },
    },
  });

  protected readonly displayedColumns = [
    'name',
    'docNumber',
    'role',
    'balance',
    'overdueAmount',
    'delinquency',
    'actions',
  ] as const;

  protected readonly policyPath = CHECKING_ACCOUNT_POLICY_PATH;

  /**
   * La política de la empresa se ofrece desde acá porque es la otra mitad de la pregunta que trae a
   * esta pantalla: quién debe, y con qué reglas. Sin el permiso el botón no está — uno que contesta
   * 403 es peor que uno ausente.
   */
  protected readonly canConfig = inject(AuthService).hasPermission(
    Permissions.checkingAccountConfig,
  );

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;

  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly filtersOpen = signal(false);
  protected readonly roleFilter = signal<PartyRole | null>(null);
  protected readonly onlyOverdue = signal(false);

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
      { labelKey: 'nav.items.checkingAccounts', link: CHECKING_ACCOUNTS_PATH },
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

  protected accountLink(account: CheckingAccountRowDto): string {
    return checkingAccountPath(account.uuid);
  }

  /** El titular puede faltar sólo si la cuenta quedó huérfana; el uuid es el último recurso. */
  protected partyName(account: CheckingAccountRowDto): string {
    return account.partyRole?.name ?? account.partyRoleUuid;
  }

  protected partyDocument(account: CheckingAccountRowDto): string {
    const role = account.partyRole;
    if (!role?.docNumber) {
      return '';
    }
    return role.docType ? `${role.docType} ${role.docNumber}` : role.docNumber;
  }

  /** Cobrar a un cliente y pagarle a un proveedor son la misma acción leída desde cada lado. */
  protected rowActionsFor(account: CheckingAccountRowDto): readonly RowAction[] {
    this.language.currentLang();

    return [
      {
        id: 'collect',
        icon: 'payments',
        label: this.translate.instant(
          account.partyRole?.role === 'SUPPLIER'
            ? 'checkingAccounts.actions.pay'
            : 'checkingAccounts.actions.collect',
        ),
      },
    ];
  }

  protected onRowAction(actionId: string, account: CheckingAccountRowDto): void {
    if (actionId === 'collect') {
      void this.router.navigateByUrl(newCollectionForAccountPath(account.uuid));
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

  protected onToggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onRoleChange(value: PartyRole | null): void {
    this.roleFilter.set(value);
    this.applyFilters();
  }

  protected onOnlyOverdueChange(value: boolean): void {
    this.onlyOverdue.set(value);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.roleFilter.set(null);
    this.onlyOverdue.set(false);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  private applyFilters(): void {
    const filters: Record<string, { value: string | boolean; matchMode: FilterMatchMode }> = {};

    const role = this.roleFilter();
    if (role) {
      filters['role'] = { value: role, matchMode: FilterMatchMode.Equals };
    }

    if (this.onlyOverdue()) {
      filters['hasOverdue'] = { value: true, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator.toQueryParams(),
      replaceUrl: true,
    });
  }
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
