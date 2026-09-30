import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { MatTablePaginator } from '../../../../core/paginate';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { CHECKING_ACCOUNTS_PATH, newCollectionForAccountPath } from '../../checking-accounts.paths';
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
  AccountPolicyDialogComponent,
  AccountPolicyDialogData,
  AccountPolicyDialogResult,
} from '../../components/account-policy-dialog/account-policy-dialog.component';
import {
  BalanceAdjustmentDialogComponent,
  BalanceAdjustmentDialogData,
  BalanceAdjustmentDialogResult,
} from '../../components/balance-adjustment-dialog/balance-adjustment-dialog.component';
import {
  DebtExtensionDialogComponent,
  DebtExtensionDialogData,
  DebtExtensionDialogResult,
} from '../../components/debt-extension-dialog/debt-extension-dialog.component';
import {
  DebtNoticeDialogComponent,
  DebtNoticeDialogData,
  DebtNoticeDialogResult,
} from '../../components/debt-notice-dialog/debt-notice-dialog.component';
import {
  DelinquencyDialogComponent,
  DelinquencyDialogData,
  DelinquencyDialogResult,
} from '../../components/delinquency-dialog/delinquency-dialog.component';
import { DelinquencyChipComponent } from '../../../../core/checking-accounts/delinquency-chip/delinquency-chip.component';
import { SettingSourceComponent } from '../../../../shared/components/setting-source/setting-source.component';
import {
  CheckingAccountPolicyDto,
  DelinquencyEventDto,
  SaveAccountPolicyRequest,
} from '../../data-access/checking-account-policy.model';
import {
  DebtTimelineDialogComponent,
  DebtTimelineDialogData,
  DebtTimelineDialogResult,
} from '../../components/debt-timeline-dialog/debt-timeline-dialog.component';
import {
  VoidCreditDialogComponent,
  VoidCreditDialogData,
  VoidCreditDialogResult,
} from '../../components/void-credit-dialog/void-credit-dialog.component';
import { DebtStateChipComponent } from '../../components/debt-state-chip/debt-state-chip.component';
import {
  ReassignDialogComponent,
  ReassignDialogData,
  ReassignDialogResult,
} from '../../components/reassign-dialog/reassign-dialog.component';
import {
  ReverseDialogComponent,
  ReverseDialogData,
  ReverseDialogResult,
} from '../../components/reverse-dialog/reverse-dialog.component';
import {
  CheckingAccountCreditRowDto,
  CheckingAccountDebtRowDto,
  CheckingAccountRowDto,
  CreditState,
  DebtState,
  StatementEntryRowDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

/** Los tres estados que el backend devuelve cuando no se le pide ninguno: las deudas abiertas. */
const OPEN_DEBT_STATES: readonly DebtState[] = ['PENDIENTE', 'PARCIAL', 'VENCIDA'];

/** Todos los estados, en el orden en que la pestaña los ofrece. */
const ALL_DEBT_STATES: readonly DebtState[] = [...OPEN_DEBT_STATES, 'PAGADA', 'ANULADA'];

/** Índice de cada pestaña, para no repartir números mágicos por el archivo. */
const TAB = {
  statement: 0,
  debts: 1,
  credits: 2,
} as const;

/**
 * Los cobros que la pestaña muestra sin tocar nada: **la bandeja**.
 *
 * `SIN_IMPUTAR` y `PARCIAL` juntos son exactamente «lo que todavía tiene plata para aplicar» —el que
 * no imputó nada y el que imputó una parte—, que es lo único sobre lo que hay algo que hacer. Es el
 * mismo criterio que las deudas abiertas en su pestaña: arrancar mostrando lo imputado y lo anulado
 * escondería el trabajo pendiente entre cobros ya cerrados.
 */
const OPEN_CREDIT_STATES: readonly CreditState[] = ['SIN_IMPUTAR', 'PARCIAL'];

/** Todos los estados, en el orden en que la pestaña los ofrece. */
const ALL_CREDIT_STATES: readonly CreditState[] = [...OPEN_CREDIT_STATES, 'IMPUTADO', 'ANULADO'];

/**
 * El estado de cuenta de un titular: el encabezado con lo que define cuánto debe, y abajo sus
 * partidas.
 *
 * **Cuatro números en el encabezado y no uno.** El saldo es `Σ pendiente − Σ sin imputar`, y con
 * imputación manual esa resta esconde el estado: plata que entró y todavía no se aplicó conviviendo
 * con una factura impaga da un neto a favor y una deuda abierta al mismo tiempo. Por eso se muestran
 * también los dos términos, y cuando los dos son distintos de cero la ficha lo dice con palabras en
 * vez de dejar que el lector lo deduzca.
 *
 * **La política se muestra acá y se edita en un diálogo.** Qué le rige a este titular es parte de
 * leer su cuenta —«¿por qué esta factura vence en 15 días?»—, así que el resumen con la fuente de
 * cada valor vive en la ficha; editarlo es otra cosa y por eso es un paso aparte.
 *
 * **Tres pestañas.** «Créditos sin imputar» es, en la práctica, la lista de tareas del
 * administrativo. Se llena poco y eso es correcto: con la imputación automática encendida casi todo
 * entra ya aplicado, y lo que queda ahí es un anticipo o plata que alguien desimputó a propósito. La
 * pestaña lo dice cuando está vacía, en vez de mostrar un blanco que parece un error.
 *
 * **Desimputar y reimputar se hacen desde la deuda, no desde el cobro.** Son operaciones sobre *una
 * imputación*, y la línea de tiempo de la deuda es el único lugar donde las imputaciones se ven de a
 * una — con quién, cuándo y por qué.
 *
 * **La pantalla no deriva nada.** El estado de cada deuda y el saldo acumulado de cada fila del
 * extracto vienen calculados del backend. Derivarlos acá dejaría que un reloj corrido en la máquina
 * del operador mostrara un estado distinto del que el sistema usa para decidir.
 *
 * **No hay compensación.** Las dos cuentas de un tercero no se netean, ni automática ni manualmente:
 * no existe la operación, ni el endpoint, ni el permiso.
 */
@Component({
  selector: 'app-checking-account-detail-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    RouterLink,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    DebtStateChipComponent,
    LoadStateComponent,
    TableWrapperComponent,
    DelinquencyChipComponent,
    SettingSourceComponent,
    MatMenuModule,
    MatCheckboxModule,
  ],
  templateUrl: './checking-account-detail.page.html',
  styleUrl: './checking-account-detail.page.css',
})
export class CheckingAccountDetailPage implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);

  /**
   * Ajustar y prorrogar comparten permiso porque son la misma clase de acto: correcciones
   * administrativas que mueven lo que el sistema informa sin que haya pasado nada comercial.
   *
   * La pantalla las esconde a quien no puede hacerlas —ofrecer un botón que va a contestar 403 es
   * peor que no ofrecerlo—, y el backend las vuelve a validar igual.
   */
  protected readonly canAdjust = this.auth.hasPermission(Permissions.checkingAccountAdjust);

  /**
   * El aviso de deuda comparte permiso con la morosidad: son las dos caras de la gestión de
   * cobranza — decidir que un cliente está en gestión, y decírselo.
   */
  protected readonly canNotify = this.auth.hasPermission(
    Permissions.checkingAccountDelinquency,
  );

  /**
   * Recalcular los caches es configuración, no operación: lo hace quien administra el módulo
   * cuando el job de consistencia reportó una diferencia y alguien decidió corregirla.
   */
  protected readonly canRecalculate = this.auth.hasPermission(Permissions.checkingAccountConfig);

  protected readonly canVoid = this.auth.hasPermission(Permissions.checkingAccountVoid);

  /**
   * Lo único editable de la ficha —la política del titular y el kill switch de la cuenta— pide
   * `config`: son decisiones de quien administra el módulo, no del mostrador.
   */
  protected readonly canConfig = this.canRecalculate;

  private readonly accountUuid = this.route.snapshot.paramMap.get('uuid') ?? '';

  protected readonly account = signal<CheckingAccountRowDto | null>(null);
  protected readonly loadState = signal<LoadState>(LoadState.Idle);
  protected readonly selectedTab = signal<number>(TAB.statement);

  protected readonly checkingAccountsPath = CHECKING_ACCOUNTS_PATH;
  protected readonly allDebtStates = ALL_DEBT_STATES;

  /* ─────────────────────────  Política del titular y morosidad  ───────────────────────── */

  /** El override del titular, con el `resolved` de lo que efectivamente le rige. */
  protected readonly policy = signal<CheckingAccountPolicyDto | null>(null);
  protected readonly policyLoading = signal(false);
  protected readonly policySaving = signal(false);
  protected readonly history = signal<readonly DelinquencyEventDto[]>([]);

  /**
   * El límite sólo se muestra en la ficha de un <b>cliente</b>.
   *
   * En una compra no se valida ningún límite —cuánto nos fía un proveedor lo decide el proveedor—, y
   * mostrar un tope que nadie mira es peor que no mostrarlo: es una invitación a que alguien lo
   * implemente.
   */
  protected readonly showsLimit = computed(() => this.account()?.partyRole?.role === 'CUSTOMER');

  protected readonly partyName = computed(
    () => this.account()?.partyRole?.name ?? this.account()?.partyRoleUuid ?? '',
  );

  protected readonly partyDocument = computed(() => {
    const role = this.account()?.partyRole;
    if (!role?.docNumber) {
      return '';
    }
    return role.docType ? `${role.docType} ${role.docNumber}` : role.docNumber;
  });

  /**
   * El cartel del saldo, que es lo único que cambia entre las dos mitades: la aritmética es una sola
   * (§3.1). Positivo en una cuenta de cliente es «nos debe»; en una de proveedor, «le debemos». Y en
   * negativo, siempre, es saldo a favor del titular.
   */
  protected readonly balanceLabel = computed(() => {
    const account = this.account();
    if ((account?.balance ?? 0) < 0) {
      return 'checkingAccounts.detail.balanceInFavour';
    }
    return account?.partyRole?.role === 'SUPPLIER'
      ? 'checkingAccounts.detail.balanceWeOwe'
      : 'checkingAccounts.detail.balanceTheyOwe';
  });

  /**
   * Un paginador por pestaña, ninguno con orden.
   *
   * `/statement` y `/debts` aceptan sólo página: el extracto une dos tablas —no hay una sobre la que
   * armar un `WHERE`— y el estado de la deuda es un `CASE` derivado, no una columna. Declarar un
   * `sortConfig` ofrecería encabezados que el backend ignora.
   */
  /**
   * Si el extracto incluye las partidas anuladas. **Por default sí**: la anulada suma cero pero se
   * sigue mostrando, porque esconderla dejaría un salto de saldo sin explicar.
   */
  protected readonly includeVoided = signal(true);

  /**
   * Los estados que la pestaña de deudas pide. Vacío = las abiertas, que es lo que el backend
   * devuelve sin `states`: pagada y anulada ya no son deuda, y arrancar mostrándolas escondería lo
   * único que hay que mirar.
   */
  protected readonly debtStates = signal<readonly DebtState[]>([]);

  protected readonly statement = new MatTablePaginator<StatementEntryRowDto>({
    fetchData: (query) => this.api.paginateStatement(this.accountUuid, query, this.includeVoided()),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
  });

  protected readonly debts = new MatTablePaginator<CheckingAccountDebtRowDto>({
    fetchData: (query) => this.api.paginateDebts(this.accountUuid, query, this.debtStates()),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
  });

  /**
   * Los estados de cobro que la pestaña pide. Vacío = la bandeja, igual que en deudas: es lo que se
   * muestra sin tocar nada, y destildar todo vuelve ahí en vez de dejar la tabla en blanco.
   */
  protected readonly creditStates = signal<readonly CreditState[]>([]);

  protected readonly allCreditStates = ALL_CREDIT_STATES;

  /**
   * Los cobros de esta cuenta, filtrados por {@link creditStates}. El orden lo pone el backend
   * —fecha de emisión descendente, desempatando por id—, así que desde acá no viaja ninguno.
   */
  protected readonly credits = new MatTablePaginator<CheckingAccountCreditRowDto>({
    fetchData: (query) => {
      const states = this.creditStates();
      return this.api.paginateAccountCredits(
        this.accountUuid,
        query,
        states.length === 0 ? OPEN_CREDIT_STATES : states,
      );
    },
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
  });

  protected readonly statementColumns = [
    'dateIssued',
    'publicId',
    'description',
    'amount',
    'runningBalance',
  ] as const;

  protected readonly debtColumns = [
    'publicId',
    'dateIssued',
    'dateDue',
    'state',
    'amount',
    'pendingAmount',
    'actions',
  ] as const;

  protected readonly creditColumns = [
    'dateIssued',
    'description',
    'origin',
    'amount',
    'unallocatedAmount',
    'actions',
  ] as const;

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.checkingAccounts', link: CHECKING_ACCOUNTS_PATH },
      { label: this.partyName() },
    ]);
  }

  ngOnInit(): void {
    this.loadAccount();
    this.statement.load();
    // La política se pide de entrada y no al abrir una pestaña: forma parte del encabezado, que es
    // lo primero que se lee. Sin ella la ficha no puede contestar por qué esta factura vence cuando
    // vence.
    this.loadPolicy();
  }

  protected onTabChange(index: number): void {
    this.selectedTab.set(index);

    // Carga perezosa: la pestaña pide sus datos la primera vez que se la abre y después conserva su
    // página, así que volver a ella no dispara otra consulta.
    if (index === TAB.debts && this.debts.loadState() === LoadState.Idle) {
      this.debts.load();
    }
    if (index === TAB.credits && this.credits.loadState() === LoadState.Idle) {
      this.credits.load();
    }
  }

  /**
   * Prender o apagar las partidas anuladas del extracto.
   *
   * La anulada suma cero y se sigue listando por default: es parte de la historia, y esconderla
   * dejaría un salto de saldo sin explicar. Poder sacarlas es para leer sólo lo que pesa.
   */
  protected onToggleVoided(include: boolean): void {
    this.includeVoided.set(include);
    this.statement.refresh();
  }

  /**
   * Cambiar el filtro vuelve a la primera página, y por eso no alcanza con `refresh()`: la página 3
   * de la bandeja no es la página 3 de los anulados, y quedarse en ella deja la tabla vacía sobre un
   * listado que sí tiene filas.
   */
  protected onToggleCreditState(state: CreditState, checked: boolean): void {
    this.creditStates.update((states) => {
      const current = states.length === 0 ? OPEN_CREDIT_STATES : states;
      return checked ? [...current, state] : current.filter((one) => one !== state);
    });
    this.credits.handlePaginateEvent({ ...this.credits.getCurrentEvent(), pageIndex: 0 });
  }

  protected isCreditStateOn(state: CreditState): boolean {
    const states = this.creditStates();
    // Sin selección explícita, la bandeja está puesta: es lo que se va a pedir.
    return states.length === 0 ? OPEN_CREDIT_STATES.includes(state) : states.includes(state);
  }

  /** Los estados de deuda que se listan. Sin ninguno tildado el backend devuelve las abiertas. */
  protected onToggleDebtState(state: DebtState, checked: boolean): void {
    this.debtStates.update((states) =>
      checked ? [...states, state] : states.filter((current) => current !== state),
    );
    this.debts.refresh();
  }

  protected isDebtStateOn(state: DebtState): boolean {
    const states = this.debtStates();
    // Sin selección explícita, las tres abiertas están puestas: es lo que el backend va a devolver.
    return states.length === 0 ? OPEN_DEBT_STATES.includes(state) : states.includes(state);
  }

  /** «Imputar ahora» lleva a la bandeja de esta cuenta, que es donde se imputa de a un cobro. */
  protected onGoToUnallocated(): void {
    // Devolver el filtro a la bandeja: el atajo promete «lo que falta imputar», y si quedaron
    // tildados los anulados llevaría justo a los cobros sobre los que no hay nada que hacer.
    this.creditStates.set([]);
    this.onTabChange(TAB.credits);
  }

  /* ─────────────────────────  Política del titular y morosidad  ───────────────────────── */

  private loadPolicy(): void {
    this.policyLoading.set(true);
    this.api
      .getAccountPolicy(this.accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) => {
          this.applyPolicy(policy);
          this.policyLoading.set(false);
        },
        error: () => {
          this.policyLoading.set(false);
          this.toast.error(this.translate.instant('checkingAccounts.override.errors.load'));
        },
      });

    this.api
      .delinquencyHistory(this.accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (events) => this.history.set(events) });
  }

  /**
   * Editar el override del titular.
   *
   * Parámetro por parámetro: puede tener plazo propio y seguir heredando el límite. **Sacar un
   * override es pasarlo a heredar** —la fila queda pero deja de decidir—, y por eso no hay «borrar
   * política»: dos caminos para lo mismo dejarían uno sin usar.
   *
   * Al guardar se recarga también el extracto: cada parámetro que efectivamente cambió deja ahí su
   * fila, con la declaración anterior y la nueva.
   */
  protected onEditPolicy(): void {
    const policy = this.policy();
    if (!policy) {
      return;
    }

    const data: AccountPolicyDialogData = {
      partyName: this.partyName(),
      policy,
      showsLimit: this.showsLimit(),
    };

    this.dialog
      .open<AccountPolicyDialogComponent, AccountPolicyDialogData, AccountPolicyDialogResult>(
        AccountPolicyDialogComponent,
        { data, width: '38rem', maxWidth: '95vw' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((request) => {
        if (!request) {
          return;
        }
        this.savePolicy(request);
      });
  }

  private savePolicy(request: SaveAccountPolicyRequest): void {
    this.policySaving.set(true);
    this.api
      .saveAccountPolicy(this.accountUuid, request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) => {
          this.applyPolicy(policy);
          this.policySaving.set(false);
          this.statement.refresh();
          this.toast.success(this.translate.instant('checkingAccounts.override.saved'));
        },
        error: () => {
          this.policySaving.set(false);
          this.toast.error(this.translate.instant('checkingAccounts.override.errors.save'));
        },
      });
  }

  /**
   * Prender o apagar la cuenta.
   *
   * Es el único freno que el módulo tiene sobre un titular puntual: el nivel de morosidad no bloquea
   * nada en ninguno de sus cuatro valores. Apagada, el medio «cuenta corriente» deja de ofrecerse en
   * el mostrador.
   */
  protected onToggleEnabled(): void {
    const account = this.account();
    if (!account) {
      return;
    }

    this.api
      .setAccountEnabled({
        uuid: account.uuid,
        enabled: !account.enabled,
        version: account.version,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.account.set(updated);
          this.toast.success(
            this.translate.instant(
              updated.enabled
                ? 'checkingAccounts.toasts.accountEnabled'
                : 'checkingAccounts.toasts.accountDisabled',
            ),
          );
        },
        error: (error: unknown) => this.reportError(error),
      });
  }

  /**
   * Fijar el nivel de morosidad.
   *
   * El diálogo se abre con el vencido y los días de la deuda más antigua a la vista: el chip dice lo
   * que alguien decidió, los números dicen lo que pasó, y quien decide tiene que ver las dos cosas
   * juntas.
   */
  protected onSetDelinquency(): void {
    const account = this.account();
    if (!account) {
      return;
    }

    const data: DelinquencyDialogData = {
      partyName: this.partyName(),
      currentLevel: account.delinquencyLevel,
      overdueAmount: account.overdueAmount,
      oldestOverdueDays: account.oldestOverdueDays,
      // El historial va en el mismo diálogo: la pregunta real es desde cuándo y quién lo decidió.
      history: this.history(),
    };

    this.dialog
      .open<DelinquencyDialogComponent, DelinquencyDialogData, DelinquencyDialogResult>(
        DelinquencyDialogComponent,
        { data, width: '34rem' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .setDelinquency(this.accountUuid, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              // Se recargan las dos cosas: el nivel vive en la ficha y el evento en el historial, y
              // el backend los escribe en la misma transacción — mostrarlos desalineados sería
              // inventar un estado que no existió.
              this.loadAccount();
              this.api
                .delinquencyHistory(this.accountUuid)
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({ next: (events) => this.history.set(events) });
              this.toast.success(this.translate.instant('checkingAccounts.delinquencyDialog.saved'));
            },
            error: () =>
              this.toast.error(this.translate.instant('checkingAccounts.delinquencyDialog.error')),
          });
      });
  }

  private applyPolicy(policy: CheckingAccountPolicyDto): void {
    this.policy.set(policy);
  }

  protected onCollect(): void {
    void this.router.navigateByUrl(newCollectionForAccountPath(this.accountUuid));
  }

  /**
   * Enviar un aviso de deuda.
   *
   * **Siempre a pedido de una persona.** No hay avisos automáticos, y el diálogo es el paso que hace
   * a la funcionalidad: el backend arma el detalle y quien conoce al cliente decide si eso es lo que
   * corresponde decirle hoy.
   *
   * Después de mandarlo se recarga el extracto y no la ficha: el aviso deja una fila, pero no mueve
   * ningún saldo.
   */
  protected onSendNotice(): void {
    const data: DebtNoticeDialogData = {
      accountUuid: this.accountUuid,
      partyName: this.partyName(),
    };

    this.dialog
      .open<DebtNoticeDialogComponent, DebtNoticeDialogData, DebtNoticeDialogResult>(
        DebtNoticeDialogComponent,
        { data, width: '44rem' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .sendNotice(this.accountUuid, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toast.success(this.translate.instant('checkingAccounts.toasts.noticeSent'));
              this.statement.refresh();
            },
            error: (error: unknown) => this.reportError(error),
          });
      });
  }

  /**
   * Si el saldo neto esconde una deuda abierta: hay plata sin imputar **y** deuda pendiente a la vez.
   *
   * No es un error ni un caso raro — es el estado normal de una cuenta en imputación manual. Lo que
   * evita es que el número se lea como «no debe nada» cuando lo que pasa es que nadie aplicó todavía
   * el cobro a la factura.
   */
  protected hidesOpenDebt(): boolean {
    const account = this.account();
    if (!account) {
      return false;
    }
    return (account.unallocatedAmount ?? 0) > 0 && (account.pendingAmount ?? 0) > 0;
  }

  /**
   * Un importe formateado para meterlo dentro de una frase.
   *
   * El aviso es una oración —«tiene $12.000 sin imputar y a la vez $12.000 vencidos»— y no una
   * tabla: partirla en tres nodos para intercalar dos `app-currency-display` dejaría la frase con
   * saltos de línea donde no van y la volvería intraducible.
   */
  protected formatAmount(value: number | null | undefined): string {
    return new Intl.NumberFormat(this.language.localeId(), {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(value ?? 0);
  }

  /**
   * El valor de un parámetro de política, listo para leer.
   *
   * Los cuatro tokens del modelo —heredar, sin tope, automático, manual— se traducen; un número se
   * muestra tal cual. Traducirlo todo por clave dejaría `policyValues.50000` en pantalla, y no
   * traducir nada dejaría `INHERIT`.
   */
  protected policyValueLabel(value: string | null): string {
    if (!value) {
      return this.translate.instant('checkingAccounts.detail.policyUnset');
    }
    const key = `checkingAccounts.policyValues.${value}`;
    const label = this.translate.instant(key);
    return label === key ? value : label;
  }

  /**
   * Recalcula los dos caches de esta cuenta.
   *
   * **El job detecta y no corrige** —una diferencia significa que hay un bug en algún camino de
   * escritura, y arreglarla sola lo escondería—, así que corregir es una decisión que alguien toma
   * acá. El backend deja registrada la diferencia que había antes de escribir.
   */
  protected onRecalculate(): void {
    this.api
      .recalculateAccount(this.accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.toast.success(
            this.translate.instant(
              report.discrepancies > 0
                ? 'checkingAccounts.override.recalculatedWithDiff'
                : 'checkingAccounts.override.recalculated',
              { count: report.discrepancies },
            ),
          );
          this.loadAccount();
          this.statement.refresh();
        },
        error: (error: unknown) => this.reportError(error),
      });
  }

  /* ─────────────────────────  Correcciones: ajuste y prórroga  ───────────────────────── */

  /**
   * Ajustar el saldo a mano.
   *
   * **El diálogo se abre recién con la política en la mano**, y no antes con un plazo inventado: el
   * vencimiento que propone tiene que ser el que le rige a este titular, o la propuesta no significa
   * nada. Son dos llamadas seguidas y no una pantalla más lenta: la política se pide una sola vez y
   * queda cacheada en la pestaña de configuración.
   */
  protected onAdjust(): void {
    const account = this.account();
    if (!account) {
      return;
    }

    const policy = this.policy();
    if (policy) {
      this.openAdjustDialog(policy.resolved.dueDays);
      return;
    }

    this.api
      .getAccountPolicy(this.accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (loaded) => {
          this.applyPolicy(loaded);
          this.openAdjustDialog(loaded.resolved.dueDays);
        },
        error: () => this.toast.error(this.translate.instant('checkingAccounts.override.errors.load')),
      });
  }

  private openAdjustDialog(dueDays: number): void {
    const account = this.account();
    if (!account) {
      return;
    }

    const data: BalanceAdjustmentDialogData = {
      partyName: this.partyName(),
      role: account.partyRole?.role ?? 'CUSTOMER',
      balance: account.balance ?? 0,
      dueDays,
    };

    this.dialog
      .open<BalanceAdjustmentDialogComponent, BalanceAdjustmentDialogData, BalanceAdjustmentDialogResult>(
        BalanceAdjustmentDialogComponent,
        { data, width: '34rem' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .adjust({
            accountUuid: this.accountUuid,
            direction: result.direction,
            amount: result.amount,
            // Un crédito no vence: en un ajuste a favor la fecha ni se manda.
            ...(result.dateDue ? { dateDue: result.dateDue } : {}),
            reason: result.reason,
          })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => this.afterLedgerChange('adjusted'),
            error: (error: unknown) => this.reportError(error),
          });
      });
  }

  /**
   * Prorrogar el vencimiento de una deuda.
   *
   * Después de prorrogar se recarga todo, y no sólo la fila: el vencido del encabezado se deriva de
   * los vencimientos, así que correr uno lo mueve. Mostrar la deuda con su fecha nueva y el vencido
   * con el número viejo sería exhibir dos verdades a la vez.
   */
  protected onExtendDebt(debt: CheckingAccountDebtRowDto): void {
    const data: DebtExtensionDialogData = { debt };

    this.dialog
      .open<DebtExtensionDialogComponent, DebtExtensionDialogData, DebtExtensionDialogResult>(
        DebtExtensionDialogComponent,
        { data, width: '34rem' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .extendDebt(debt.uuid, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => this.afterLedgerChange('extended'),
            error: (error: unknown) => this.reportError(error),
          });
      });
  }

  protected onStatementPage(event: PageEvent): void {
    this.statement.handlePageEvent(event);
  }

  protected onDebtsPage(event: PageEvent): void {
    this.debts.handlePageEvent(event);
  }

  protected onUnallocatedPage(event: PageEvent): void {
    this.credits.handlePageEvent(event);
  }

  /**
   * Imputar un cobro a mano: se abre con las deudas abiertas de la cuenta y la propuesta FIFO ya
   * cargada, para editarla.
   *
   * Las deudas se piden en el momento y no se reusan las de la pestaña: entre que alguien miró esa
   * lista y decide imputar pudo pasar cualquier cosa, y el diálogo tiene que proponer sobre lo que la
   * cuenta debe ahora.
   */
  /**
   * A qué deudas se aplicó este cobro, y por cuánto.
   *
   * Es la línea de tiempo mirada desde el otro lado: la bandeja mostraba cuánto quedaba sin imputar
   * pero no dónde había ido lo demás, que es la primera pregunta cuando un cobro figura parcial.
   */
  protected onCreditAllocations(credit: CheckingAccountCreditRowDto): void {
    const data: DebtTimelineDialogData = { credit };

    this.dialog
      .open<DebtTimelineDialogComponent, DebtTimelineDialogData, DebtTimelineDialogResult>(
        DebtTimelineDialogComponent,
        { data, width: '42rem', maxWidth: '95vw' },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        // Desde el cobro se ofrece deshacer y no reimputar: reimputar necesita la deuda de origen
        // como fila, y acá sólo se tiene su uuid. El diálogo lo esconde, y esto es la red.
        if (result?.action === 'reverse') {
          this.openReverse(result);
        } else if (result?.action === 'trace') {
          // Sin la deuda, por lo mismo: no hay endpoint para leer una deuda suelta.
          this.openTrace(result);
        }
      });
  }

  /**
   * A dónde fue la plata de una imputación.
   *
   * Es una consulta y no una operación: el diálogo no devuelve nada y no escribe nada. Vive acá
   * —y no dentro de la línea de tiempo— por el mismo motivo que desimputar y reimputar: el diálogo
   * de historia no tiene por qué saber qué se puede hacer con lo que muestra.
   */
  private openTrace(source: DebtTimelineDialogResult, debt?: CheckingAccountDebtRowDto): void {
    this.dialog.open<AllocationTraceDialogComponent, AllocationTraceDialogData, void>(
      AllocationTraceDialogComponent,
      // La deuda viaja cuando quien abre la tiene en la mano: con ella la tarjeta arranca en el
      // importe emitido y termina en el pendiente de hoy, que son los dos números que la hacen
      // verificable. Desde el cobro no se tiene, y sin endpoint para leer una deuda suelta la
      // alternativa sería estimarla — justo el número que la tarjeta existe para contrastar.
      { data: { allocation: source.allocation, debt }, width: '46rem', maxWidth: '95vw' },
    );
  }

  /**
   * Anular el cobro desde la ficha.
   *
   * También vive en «Cobros y pagos», que es donde se busca un recibo por su número. Acá el cobro ya
   * está a la vista: mandar a buscarlo a otra pantalla sería trabajo inventado.
   */
  protected onVoidCredit(credit: CheckingAccountCreditRowDto): void {
    const data: VoidCreditDialogData = { creditUuid: credit.uuid, publicId: credit.publicId };

    this.dialog
      .open<VoidCreditDialogComponent, VoidCreditDialogData, VoidCreditDialogResult>(
        VoidCreditDialogComponent,
        { data, width: '38rem', maxWidth: '95vw' },
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
              // Anular mueve el saldo y devuelve deudas a impagas: se recarga todo, no sólo la
              // bandeja de la que salió.
              this.refreshAfterChange();
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

  protected onAllocate(credit: CheckingAccountCreditRowDto): void {
    this.api
      .paginateDebts(this.accountUuid, { page: 1, size: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((page) => {
        const data: AllocateDialogData = {
          credit,
          partyName: this.partyName(),
          role: this.account()?.partyRole?.role ?? 'CUSTOMER',
          debts: page.content ?? [],
        };

        this.dialog
          .open<AllocateDialogComponent, AllocateDialogData, AllocateDialogResult>(
            AllocateDialogComponent,
            // `maxWidth` explícito: el default de Material es 80vw, y con el ancho fijo el
            // diálogo quedaba recortado en una ventana angosta en vez de achicarse.
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
                next: () => this.afterLedgerChange('allocated'),
                error: (error: unknown) => this.reportError(error),
              });
          });
      });
  }

  /**
   * La historia de una deuda, y desde ahí desimputar o reimputar.
   *
   * El diálogo de la línea de tiempo no opera: devuelve qué se pidió sobre qué imputación, y es esta
   * pantalla la que abre el que corresponde. Así el diálogo de historia no necesita saber nada de las
   * dos operaciones, y las dos operaciones no necesitan saber de dónde se las llamó.
   */
  protected onDebtHistory(debt: CheckingAccountDebtRowDto): void {
    this.dialog
      .open<DebtTimelineDialogComponent, DebtTimelineDialogData, DebtTimelineDialogResult>(
        DebtTimelineDialogComponent,
        // Mas ancho que los demas: entran dos columnas —el panel de contexto y la linea de tiempo—.
        // Mas ancho que los demas —entran dos columnas— pero con tope relativo: sin `maxWidth`,
        // Material lo corta en 80vw y la grilla queda apretada en una pantalla chica.
        {
          data: { debt, partyRole: this.account()?.partyRole?.role ?? undefined },
          width: '64rem',
          maxWidth: '95vw',
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result?.action === 'reverse') {
          this.openReverse(result);
        } else if (result?.action === 'reassign') {
          this.openReassign(result, debt);
        } else if (result?.action === 'trace') {
          this.openTrace(result, debt);
        }
      });
  }

  private openReverse(request: DebtTimelineDialogResult): void {
    const data: ReverseDialogData = {
      allocation: request.allocation,
      activeAmount: request.activeAmount,
    };

    this.dialog
      .open<ReverseDialogComponent, ReverseDialogData, ReverseDialogResult>(
        ReverseDialogComponent,
        {
          data,
          width: '34rem',
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        this.api
          .reverseAllocation(request.allocation.uuid, result)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => this.afterLedgerChange('reversed'),
            error: (error: unknown) => this.reportError(error),
          });
      });
  }

  /** El destino excluye la deuda de origen: reimputar a la misma deuda no mueve nada. */
  private openReassign(request: DebtTimelineDialogResult, source: CheckingAccountDebtRowDto): void {
    this.api
      .paginateDebts(this.accountUuid, { page: 1, size: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((page) => {
        const data: ReassignDialogData = {
          allocation: request.allocation,
          activeAmount: request.activeAmount,
          debts: (page.content ?? []).filter((debt) => debt.uuid !== source.uuid),
        };

        this.dialog
          .open<ReassignDialogComponent, ReassignDialogData, ReassignDialogResult>(
            ReassignDialogComponent,
            { data, width: '34rem' },
          )
          .afterClosed()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((result) => {
            if (!result) {
              return;
            }
            this.api
              .reassignAllocation(request.allocation.uuid, result)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => this.afterLedgerChange('reassigned'),
                error: (error: unknown) => this.reportError(error),
              });
          });
      });
  }

  /**
   * Después de tocar el libro se recarga todo lo que la pantalla muestra, y no sólo la pestaña
   * activa: imputar cambia el pendiente de una deuda, lo disponible de un cobro y el saldo del
   * encabezado a la vez. Refrescar una sola dejaría las otras dos diciendo algo que ya no es cierto.
   */
  private afterLedgerChange(
    action: 'allocated' | 'reversed' | 'reassigned' | 'adjusted' | 'extended',
  ): void {
    this.toast.success(this.translate.instant(`checkingAccounts.toasts.${action}`));
    this.refreshAfterChange();
  }

  /**
   * Lo que hay que releer después de tocar el libro: el saldo, el extracto y las pestañas que ya se
   * habían abierto.
   *
   * Las que están en `Idle` no se tocan a propósito — cargarlas acá le pediría al backend dos
   * consultas por una pestaña que nadie miró, y cuando alguien la abra se va a cargar sola.
   */
  private refreshAfterChange(): void {
    this.loadAccount();
    this.statement.refresh();
    if (this.debts.loadState() !== LoadState.Idle) {
      this.debts.refresh();
    }
    if (this.credits.loadState() !== LoadState.Idle) {
      this.credits.refresh();
    }
  }

  private reportError(error: unknown): void {
    this.toast.error(
      error instanceof Error && error.message
        ? error.message
        : this.translate.instant('checkingAccounts.toasts.ledgerError'),
    );
  }

  protected onRetry(): void {
    this.loadAccount();
    this.statement.refresh();
  }

  private loadAccount(): void {
    this.loadState.set(LoadState.Loading);

    this.api
      .getAccount(this.accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (account) => {
          this.account.set(account);
          this.loadState.set(LoadState.Success);
        },
        error: () => {
          this.account.set(null);
          this.loadState.set(LoadState.Error);
        },
      });
  }
}
