import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { ToastService } from '../../../../core/notifications/toast.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { FilterMatchMode, MatTablePaginator } from '../../../../core/paginate';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  COLLECTIONS_PATH,
  NEW_COLLECTION_PATH,
  checkingAccountPath,
} from '../../checking-accounts.paths';
import {
  AllocateDialogComponent,
  AllocateDialogData,
  AllocateDialogResult,
} from '../../components/allocate-dialog/allocate-dialog.component';
import {
  AllocationTraceDialogComponent,
  AllocationTraceDialogData,
} from '../../components/allocation-trace-dialog/allocation-trace-dialog.component';
import {
  DebtTimelineDialogComponent,
  DebtTimelineDialogData,
  DebtTimelineDialogResult,
} from '../../components/debt-timeline-dialog/debt-timeline-dialog.component';
import {
  ReverseDialogComponent,
  ReverseDialogData,
  ReverseDialogResult,
} from '../../components/reverse-dialog/reverse-dialog.component';
import {
  VoidCreditDialogComponent,
  VoidCreditDialogData,
  VoidCreditDialogResult,
} from '../../components/void-credit-dialog/void-credit-dialog.component';
import {
  CheckingAccountCreditRowDto,
  CreditState,
  PartyRole,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

const CREDIT_STATES: readonly CreditState[] = ['SIN_IMPUTAR', 'PARCIAL', 'IMPUTADO', 'ANULADO'];
const PARTY_ROLES: readonly PartyRole[] = ['CUSTOMER', 'SUPPLIER'];

/**
 * Cobros y pagos registrados, de toda la empresa y en una sola tabla.
 *
 * La columna que justifica la pantalla es **sin imputar**: con la imputación automática encendida
 * casi todo entra aplicado, así que lo que queda en esa columna es exactamente lo que necesita que
 * alguien lo mire — un anticipo, o plata que alguien desimputó a propósito.
 *
 * **Tres de las columnas no existen en la tabla del backend** y las traduce él: `partyName` vive en
 * `parties`, `role` en `party_roles`, y `state` es un `CASE` sobre tres columnas. Filtrar por ellas
 * es pedirlas por su nombre; ordenar por `state` no se ofrece, porque se resuelve como un `IN` de
 * ids y no como una columna.
 *
 * **Tres acciones por fila**: imputar, desimputar y anular. Las dos primeras redistribuyen plata que
 * ya entró —no tocan la caja, no emiten comprobante y no exigen sesión—; la tercera deshace un
 * ingreso de dinero, y por eso lleva otro permiso y otra palabra.
 *
 * **Las tres viven acá y también en la ficha.** Ésta es la pantalla donde un recibo se busca por su
 * número —«el REC-000148 no debió existir»—, que es como llega la mayoría de los pedidos; parado en
 * la bandeja de una cuenta el cobro ya está a la vista, y mandar a buscarlo por número lo que se
 * tiene delante es trabajo inventado.
 */
@Component({
  selector: 'app-collections-page',
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
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  templateUrl: './collections.page.html',
  styleUrl: './collections.page.css',
})
export class CollectionsPage implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);

  /**
   * Anular es la operación de más impacto del módulo, y tiene permiso propio: quien cobra no
   * necesariamente puede deshacer un cobro. Sin él la acción ni se ofrece.
   */
  protected readonly canVoid = this.auth.hasPermission(Permissions.checkingAccountVoid);

  /**
   * Imputar y desimputar son un permiso propio y distinto de cobrar: quien cobra en el mostrador no
   * es necesariamente quien decide contra qué factura se aplica esa plata.
   */
  protected readonly canAllocate = this.auth.hasPermission(Permissions.checkingAccountAllocate);

  protected readonly paginator = new MatTablePaginator<CheckingAccountCreditRowDto>({
    fetchData: (query) => this.api.paginateCollections(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    // Por titular y por número de recibo: son las dos formas en que alguien busca un cobro —«el de
    // Distribuidora Sur» o «el REC-000148 que me está reclamando».
    // `partyName` es pseudo-columna y la traduce el backend; `public_id` es una columna de verdad
    // y por eso va con su nombre real — el paginado arma SQL nativo y no traduce nada por su cuenta.
    globalSearchConfig: [
      { tabla: 't', columna: 'partyName' },
      { tabla: 't', columna: 'public_id' },
    ],
    // **Los nombres de columna van en snake_case.** El paginado del Core arma SQL nativo
    // concatenando `tabla.columna direccion`, así que `t.dateIssued` es una columna que Postgres no
    // tiene y la consulta rompe. La excepción es `partyName`: ésa sí es una pseudo-columna, y el
    // backend la traduce a `parties.name` con su JOIN.
    sortConfig: {
      publicId: { tabla: 't', columna: 'public_id' },
      dateIssued: { tabla: 't', columna: 'date_issued' },
      partyName: { tabla: 't', columna: 'partyName' },
      amount: { tabla: 't', columna: 'amount' },
      unallocatedAmount: { tabla: 't', columna: 'unallocated_amount' },
    },
    // El último cobro primero: la pregunta que trae a esta pantalla es «qué entró recién», y un
    // recibo viejo no se busca recorriendo el listado sino por su número.
    defaultSort: { columnKey: 'dateIssued', direction: 'desc' },
    filterConfig: {
      role: { tabla: 't', columna: 'role' },
      state: { tabla: 't', columna: 'state' },
      onlyUnallocated: { tabla: 't', columna: 'onlyUnallocated' },
    },
  });

  protected readonly displayedColumns = [
    'publicId',
    'dateIssued',
    'partyName',
    'description',
    'state',
    'amount',
    'unallocatedAmount',
    'actions',
  ];

  protected readonly creditStates = CREDIT_STATES;
  protected readonly partyRoles = PARTY_ROLES;
  protected readonly newCollectionPath = NEW_COLLECTION_PATH;

  protected roleFilter: PartyRole | '' = '';
  protected stateFilter: CreditState | '' = '';

  /**
   * **La bandeja de trabajo.** Con la imputación automática encendida casi todo entra ya aplicado,
   * así que sin este filtro el listado muestra todos los cobros justo cuando no hay ninguno
   * pendiente. Lo que queda con plata sin aplicar es exactamente lo que necesita que alguien lo
   * mire: un anticipo, o plata que alguien desimputó a propósito.
   */
  protected onlyUnallocated = false;

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.collections', link: COLLECTIONS_PATH },
    ]);
  }

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;

  ngOnInit(): void {
    this.paginator.load();
  }

  protected accountPath(row: CheckingAccountCreditRowDto): string {
    return checkingAccountPath(row.accountUuid ?? '');
  }

  protected onSearch(term: string): void {
    this.paginator.setGlobalFilter(term);
  }

  protected onRoleFilter(role: PartyRole | ''): void {
    this.roleFilter = role;
    this.applyFilters();
  }

  protected onStateFilter(state: CreditState | ''): void {
    this.stateFilter = state;
    this.applyFilters();
  }

  protected onOnlyUnallocated(value: boolean): void {
    this.onlyUnallocated = value;
    this.applyFilters();
  }

  /**
   * Los dos filtros viajan juntos y en modo exacto: `role` y `state` son valores cerrados, no textos
   * que se busquen por parecido.
   */
  private applyFilters(): void {
    const filters: Record<string, { value: string; matchMode: FilterMatchMode }> = {};
    if (this.roleFilter) {
      filters['role'] = { value: this.roleFilter, matchMode: FilterMatchMode.Equals };
    }
    if (this.stateFilter) {
      filters['state'] = { value: this.stateFilter, matchMode: FilterMatchMode.Equals };
    }
    // Pseudo-columna: el backend la traduce a «lo que le queda sin imputar es mayor que cero».
    if (this.onlyUnallocated) {
      filters['onlyUnallocated'] = { value: 'true', matchMode: FilterMatchMode.Equals };
    }
    this.paginator.setFilters(filters);
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
  }

  /**
   * Anular un cobro.
   *
   * El diálogo pide su propia previa —qué deudas vuelven a quedar impagas, cuánto sale de la caja—
   * porque el listado no la tiene: la fila dice cuánto entró, no contra qué se aplicó.
   */
  protected onVoid(credit: CheckingAccountCreditRowDto): void {
    const data: VoidCreditDialogData = { creditUuid: credit.uuid, publicId: credit.publicId };

    this.dialog
      .open<VoidCreditDialogComponent, VoidCreditDialogData, VoidCreditDialogResult>(
        VoidCreditDialogComponent,
        { data, width: '38rem' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .voidCredit(credit.uuid, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toast.success(this.translate.instant('checkingAccounts.toasts.voidDone'));
              this.paginator.refresh();
            },
            error: (error: unknown) =>
              this.toast.error(
                error instanceof Error && error.message
                  ? error.message
                  : this.translate.instant('checkingAccounts.toasts.voidError'),
              ),
          });
      });
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
  }

  /**
   * Imputar el cobro a una o varias deudas del titular.
   *
   * **No mueve plata**: redistribuye lo que ya entró, así que no toca la caja, no emite comprobante
   * y no exige sesión. Las deudas van en orden de vencimiento, el mismo del FIFO, para que elegir a
   * mano parta de lo que el sistema haría solo.
   */
  protected onAllocate(credit: CheckingAccountCreditRowDto): void {
    const accountUuid = credit.accountUuid;
    if (!accountUuid) {
      return;
    }

    this.api
      .paginateDebts(accountUuid, { page: 1, size: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((page) => {
        const data: AllocateDialogData = {
          credit,
          partyName: credit.partyRole?.name ?? '',
          role: credit.partyRole?.role ?? 'CUSTOMER',
          debts: page.content ?? [],
        };

        this.dialog
          .open<AllocateDialogComponent, AllocateDialogData, AllocateDialogResult>(
            AllocateDialogComponent,
            { data, width: '46rem', maxWidth: '95vw' },
          )
          .afterClosed()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            if (!result?.length) {
              return;
            }
            this.api
              .allocate(credit.uuid, result)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => {
                  this.toast.success(
                    this.translate.instant('checkingAccounts.toasts.allocated'),
                  );
                  this.paginator.refresh();
                },
                error: (error: unknown) => this.reportError(error),
              });
          });
      });
  }

  /**
   * A qué deudas se aplicó este cobro, y desde ahí desimputar.
   *
   * El diálogo de la línea de tiempo no opera: devuelve qué se pidió sobre qué imputación, y es esta
   * pantalla la que abre el que corresponde. Desde el cobro se ofrece deshacer y no reimputar —
   * reimputar necesita la deuda de origen como fila, y acá sólo se tiene su uuid.
   */
  protected onAllocations(credit: CheckingAccountCreditRowDto): void {
    this.dialog
      .open<DebtTimelineDialogComponent, DebtTimelineDialogData, DebtTimelineDialogResult>(
        DebtTimelineDialogComponent,
        { data: { credit } satisfies DebtTimelineDialogData, width: '42rem', maxWidth: '95vw' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result?.action === 'reverse') {
          this.openReverse(result);
        } else if (result?.action === 'trace') {
          this.dialog.open<AllocationTraceDialogComponent, AllocationTraceDialogData, void>(
            AllocationTraceDialogComponent,
            { data: { allocation: result.allocation }, width: '46rem', maxWidth: '95vw' },
          );
        }
      });
  }

  /**
   * Desimputar: deshace el vínculo con la deuda y la plata vuelve a estar disponible **en el mismo
   * cobro**. El saldo de la cuenta no se mueve; lo que se mueve es el vencido.
   */
  private openReverse(source: DebtTimelineDialogResult): void {
    const data: ReverseDialogData = {
      allocation: source.allocation,
      activeAmount: source.activeAmount,
    };

    this.dialog
      .open<ReverseDialogComponent, ReverseDialogData, ReverseDialogResult>(ReverseDialogComponent, {
        data,
        width: '38rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .reverseAllocation(source.allocation.uuid, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toast.success(this.translate.instant('checkingAccounts.toasts.reversed'));
              this.paginator.refresh();
            },
            error: (error: unknown) => this.reportError(error),
          });
      });
  }

  private reportError(error: unknown): void {
    this.toast.error(
      error instanceof Error && error.message
        ? error.message
        : this.translate.instant('checkingAccounts.toasts.allocateError'),
    );
  }
}
