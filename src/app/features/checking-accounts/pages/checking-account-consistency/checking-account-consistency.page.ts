import { Component, OnInit, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { MatTablePaginator } from '../../../../core/paginate';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { CHECKING_ACCOUNT_CONSISTENCY_PATH, checkingAccountPath } from '../../checking-accounts.paths';
import {
  ConsistencyDiscrepancyDto,
  ConsistencyReportDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

/**
 * Las diferencias entre los dos caches del módulo —el saldo y el nivel de morosidad— y lo que dicen
 * las partidas.
 *
 * **Verificar no corrige, y esa es la pantalla entera.** Una diferencia en el saldo significa que
 * hay un bug en algún camino de escritura; corregirla en silencio lo esconde, porque el saldo vuelve
 * a cerrar y el bug sigue ahí. Recalcular existe —alguien tiene que poder decidir que sí— pero es
 * una decisión de una persona, registra la diferencia antes de escribir y deja la fila **marcada
 * como revisada, no borrada**: borrarla dejaría al próximo lector sin saber si la cuenta ya se
 * revisó o si nunca falló.
 *
 * Las dos columnas de valores se llaman «el cache dice» y «las partidas dicen», y no
 * «esperado / real»: el punto de la fila es cuál de los dos es la verdad.
 */
@Component({
  selector: 'app-checking-account-consistency-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
    TableWrapperComponent,
  ],
  templateUrl: './checking-account-consistency.page.html',
  styleUrl: './checking-account-consistency.page.css',
})
export class CheckingAccountConsistencyPage implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly paginator = new MatTablePaginator<ConsistencyDiscrepancyDto>({
    fetchData: (query) => this.api.paginateDiscrepancies(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 20,
    // En snake_case: el paginado del Core arma SQL nativo con `tabla.columna`, y `t.dateDetected`
    // no existe. La fecha de detección **es** el `date_created` de la fila: el mapper la expone con
    // otro nombre porque para quien lee es cuándo se detectó, no cuándo se insertó.
    sortConfig: {
      dateDetected: { tabla: 't', columna: 'date_created' },
      invariantCode: { tabla: 't', columna: 'invariant_code' },
    },
    // Lo detectado en la última corrida arriba: una diferencia de hace tres meses ya la miró
    // alguien, y la que importa es la que apareció recién.
    defaultSort: { columnKey: 'dateDetected', direction: 'desc' },
  });

  protected readonly displayedColumns = [
    'dateDetected',
    'party',
    'invariantCode',
    'cachedValue',
    'derivedValue',
    'difference',
    'actions',
  ];

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;

  /**
   * Lo que devolvió la corrida que se pidió **en esta pantalla**.
   *
   * Nulo mientras no se haya corrido ninguna, y ahí el encabezado no dice nada: el backend no expone
   * cuándo corrió la última vez, y estampar una fecha inventada sobre una verificación es peor que
   * no estamparla. «No encontré nada» y «no miré nada» se leen igual, así que sólo se informa lo que
   * consta.
   */
  protected readonly lastRun = signal<ConsistencyReportDto | null>(null);
  protected readonly running = signal(false);
  protected readonly recalculating = signal<string | null>(null);

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      {
        labelKey: 'nav.items.checkingAccountConsistency',
        link: CHECKING_ACCOUNT_CONSISTENCY_PATH,
      },
    ]);
  }

  ngOnInit(): void {
    this.paginator.load();
  }

  protected accountPath(row: ConsistencyDiscrepancyDto): string {
    return checkingAccountPath(row.accountUuid);
  }

  /** Una fila revisada sigue en la lista, en gris y con su fecha. */
  protected isResolved(row: ConsistencyDiscrepancyDto): boolean {
    return row.resolvedAt != null;
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
  }

  /**
   * Corre la verificación sobre todas las cuentas activas de la empresa. No escribe ningún cache y
   * no le manda nada a nadie: deja una fila por diferencia y sella la fecha.
   */
  protected onRun(): void {
    if (this.running()) {
      return;
    }

    this.running.set(true);
    this.api
      .runConsistency()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.running.set(false);
          this.lastRun.set(report);
          this.paginator.refresh();
          this.toast.success(
            this.translate.instant('checkingAccounts.consistency.toasts.runDone', {
              accounts: report.accountsChecked,
              found: report.discrepancies,
            }),
          );
        },
        error: () => {
          this.running.set(false);
          this.toast.error(this.translate.instant('checkingAccounts.consistency.toasts.runError'));
        },
      });
  }

  /**
   * Recalcular reescribe un cache, así que se confirma: es la única acción de la pantalla que
   * cambia un dato, y la que deja la diferencia dada por revisada.
   */
  protected onRecalculate(row: ConsistencyDiscrepancyDto): void {
    this.confirm
      .confirm({
        title: this.translate.instant('checkingAccounts.consistency.recalculate.title'),
        message: this.translate.instant('checkingAccounts.consistency.recalculate.message', {
          party: this.partyName(row),
        }),
        confirmLabel: this.translate.instant('checkingAccounts.consistency.recalculate.confirm'),
        confirmColor: 'primary',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }

        this.recalculating.set(row.uuid);
        this.api
          .recalculateAccount(row.accountUuid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.recalculating.set(null);
              this.toast.success(
                this.translate.instant('checkingAccounts.consistency.toasts.recalculateDone'),
              );
              this.paginator.refresh();
            },
            error: () => {
              this.recalculating.set(null);
              this.toast.error(
                this.translate.instant('checkingAccounts.consistency.toasts.recalculateError'),
              );
            },
          });
      });
  }

  protected partyName(row: ConsistencyDiscrepancyDto): string {
    return (
      row.partyRole?.name ?? this.translate.instant('checkingAccounts.consistency.unknownParty')
    );
  }
}
