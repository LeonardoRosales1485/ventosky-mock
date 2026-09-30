import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, of, switchMap } from 'rxjs';
import { hasOpenSession } from '../../../../core/cash-session/cash-session.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  CHECKING_ACCOUNTS_PATH,
  NEW_COLLECTION_PATH,
  checkingAccountPath,
} from '../../checking-accounts.paths';
import {
  AllocationInput,
  AllocationPreviewDto,
  CheckingAccountDebtRowDto,
  CheckingAccountRowDto,
  PaymentMethodOption,
  toIsoDate,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

interface PaymentRow {
  /** Clave estable del `@for`: el medio puede cambiar y la fila sigue siendo la misma. */
  id: number;
  paymentMethodUuid: string;
  amount: number | null;
}

type AllocationChoice = 'AUTO' | 'MANUAL';

/** Las opciones del selector de modo, en el orden de siempre: automático primero. */
const ALLOCATION_CHOICES: readonly { value: AllocationChoice; labelKey: string }[] = [
  { value: 'AUTO', labelKey: 'checkingAccounts.newCollection.modeAuto' },
  { value: 'MANUAL', labelKey: 'checkingAccounts.newCollection.modeManual' },
];

/**
 * Registrar un cobro (cliente) o un pago (proveedor) contra una cuenta corriente.
 *
 * Una sola pantalla para los dos casos porque es una sola operación: lo único que cambia es el
 * cartel, no la aritmética (§3.1).
 *
 * Dos cosas que son propias de acá:
 *
 * - **La vista previa la calcula el backend**, con la misma función que después escribe las
 *   imputaciones. Replicar el FIFO en el front sería una segunda implementación de la misma regla,
 *   y la promesa de que la previa coincide con lo que queda imputado duraría hasta que alguien
 *   tocara una de las dos.
 * - **El aviso de caja llega al elegir el medio**, no al confirmar. Un cobro que toca caja exige
 *   sesión, y enterarse recién al apretar «cobrar» —con el formulario entero cargado— es la clase de
 *   error que se paga tipeando todo de nuevo.
 *
 * - **El importe no es un campo.** Es la suma de los medios, y se muestra como total calculado:
 *   aceptarlo aparte abriría la única forma de que un cobro diga $100.000 mientras sus medios suman
 *   $90.000. El backend lo deriva igual, así que un campo propio sólo podría contradecirlo.
 * - **El reparto viaja en el mismo request que el cobro.** Cobrar primero y corregir después dejaría
 *   al FIFO aplicar la plata en el medio, y arreglarlo obliga a desimputar. Por eso «elegir yo» no
 *   es otra pantalla: es la misma operación.
 *
 * **Volver a FIFO es un botón y no un modo escondido**: es la salida cuando el reparto a mano se
 * enredó, y sin él la única forma de deshacerlo es tipear los ceros uno por uno.
 */
@Component({
  selector: 'app-new-collection-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatButtonToggleModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
  ],
  // El calendario nativo cae al locale del navegador, que en una máquina en inglés muestra
  // `8/24/2026` en una pantalla que el resto del tiempo escribe en español. Se le pasa el mismo
  // locale que usa `LocalizedDatePipe`, así la fecha se lee igual en toda la app.
  providers: [
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useFactory: () => inject(LanguageService).localeId() },
  ],
  templateUrl: './new-collection.page.html',
  styleUrl: './new-collection.page.css',
})
export class NewCollectionPage implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly accounts = signal<readonly CheckingAccountRowDto[]>([]);
  protected readonly paymentMethods = signal<readonly PaymentMethodOption[]>([]);

  protected readonly selectedAccountUuid = signal<string | null>(null);
  protected readonly preview = signal<AllocationPreviewDto | null>(null);
  protected readonly previewLoading = signal(false);

  /** La caja del usuario y si tiene sesión abierta. Sin resolver todavía = `null`. */
  private readonly cashRegisterUuid = signal<string | null>(null);
  private readonly cashSessionOpen = signal<boolean | null>(null);

  protected readonly dateIssued = signal<Date>(new Date());
  protected readonly description = signal('');

  /* ─────────────────────────  Contra qué se aplica  ───────────────────────── */

  /** `AUTO` deja correr el FIFO; `MANUAL` manda el reparto que armó quien cobra. */
  protected readonly allocationMode = signal<AllocationChoice>('AUTO');

  /**
   * El modo que rige para el titular según su política —la propia, la de la empresa o el default—.
   * `null` mientras no se sabe: sin titular, con la lectura en camino o si falló.
   */
  private readonly configuredMode = signal<AllocationChoice | null>(null);

  /**
   * Si quien cobra ya eligió el modo para este titular. Desde ahí la política no lo pisa: decide con
   * qué modo arranca la pantalla, no con cuál termina.
   */
  private modeChosen = false;

  /**
   * Las opciones del selector, con el modo que rige para el titular primero. Sin saber cuál rige
   * queda el orden de siempre: automático primero.
   */
  protected readonly allocationChoices = computed(() => {
    const configured = this.configuredMode();
    return [
      ...ALLOCATION_CHOICES.filter((choice) => choice.value === configured),
      ...ALLOCATION_CHOICES.filter((choice) => choice.value !== configured),
    ];
  });

  /** Las deudas abiertas del titular, en orden de vencimiento — el mismo del FIFO. */
  protected readonly openDebts = signal<readonly CheckingAccountDebtRowDto[]>([]);

  /** Cuánto aplica el operador a cada deuda, por uuid. Vacío = no le aplica nada. */
  protected readonly manualAmounts = signal<Record<string, number | null>>({});
  protected readonly payments = signal<readonly PaymentRow[]>([
    { id: 1, paymentMethodUuid: '', amount: null },
  ]);

  protected readonly submitting = signal(false);

  private nextPaymentId = 2;

  protected readonly selectedAccount = computed(
    () => this.accounts().find((account) => account.uuid === this.selectedAccountUuid()) ?? null,
  );

  protected readonly paymentsTotal = computed(() =>
    round(this.payments().reduce((total, payment) => total + (payment.amount ?? 0), 0)),
  );

  /* ─────────────  El reparto a mano: se valida en bloque, no línea por línea  ───────────── */

  protected readonly manualTotal = computed(() =>
    round(
      Object.values(this.manualAmounts()).reduce<number>((total, value) => total + (value ?? 0), 0),
    ),
  );

  /** Lo que el reparto todavía no asignó. Negativo = se pasó del cobro. */
  protected readonly manualUnassigned = computed(() =>
    round(this.paymentsTotal() - this.manualTotal()),
  );

  /**
   * Las líneas que le aplican a una deuda más de lo que esa deuda debe.
   *
   * Es la otra mitad de la validación: **el reparto se valida en bloque y no línea por línea** —dos
   * líneas de $600 sobre un cobro de $1.000 pasarían las dos por separado—, pero una línea que
   * supera su propio pendiente también rebota, y decir las dos cosas juntas evita el ida y vuelta.
   */
  protected readonly manualOverflow = computed(() =>
    this.openDebts()
      .map((debt) => ({
        debt,
        excess: round((this.manualAmounts()[debt.uuid] ?? 0) - debt.pendingAmount),
      }))
      .filter((line) => line.excess > 0),
  );

  protected readonly manualValid = computed(
    () =>
      this.allocationMode() === 'AUTO' ||
      (this.manualUnassigned() >= -0.005 && this.manualOverflow().length === 0),
  );

  /**
   * Si va el recuadro de simulación: acompaña a lo que la sección muestra como resultado. En
   * automático es la previa, que recién existe con titular e importe; a mano, el reparto, que se
   * arma apenas hay titular.
   */
  protected readonly hasSimulation = computed(() =>
    this.allocationMode() === 'AUTO' ? this.preview() !== null : this.selectedAccount() !== null,
  );

  /** Un cobro que toca caja exige sesión que cubra su fecha (§11). */
  protected readonly touchesCashRegister = computed(() =>
    this.payments().some(
      (payment) =>
        this.paymentMethods().find((method) => method.uuid === payment.paymentMethodUuid)
          ?.affectsCashRegister ?? false,
    ),
  );

  /** `true` si la fecha elegida es hoy: es el único caso que la pantalla puede evaluar sola. */
  protected readonly dateIsToday = computed(
    () => toIsoDate(this.dateIssued()) === toIsoDate(new Date()),
  );

  /**
   * El aviso temprano: hay un medio que toca caja y no hay sesión abierta.
   *
   * **Sólo para hoy.** Una sesión abierta cubre únicamente su propio día, así que para un cobro
   * fechado hoy la pregunta se contesta con lo que ya sabemos. Para una fecha anterior habría que
   * saber qué sesión cerrada la cubre, y eso lo resuelve el backend al confirmar — avisar acá sería
   * adivinar, y un aviso equivocado es peor que ninguno.
   */
  protected readonly missingCashSession = computed(
    () => this.touchesCashRegister() && this.dateIsToday() && this.cashSessionOpen() === false,
  );

  protected readonly canSubmit = computed(
    () =>
      !this.submitting() &&
      !!this.selectedAccount() &&
      this.paymentsTotal() > 0 &&
      this.manualValid() &&
      this.payments().every(
        (payment) => !!payment.paymentMethodUuid && (payment.amount ?? 0) > 0,
      ) &&
      (!this.touchesCashRegister() || !!this.cashRegisterUuid()),
  );

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.checkingAccounts', link: CHECKING_ACCOUNTS_PATH },
      { labelKey: 'nav.items.newCollection', link: NEW_COLLECTION_PATH },
    ]);

    // La previa se recalcula sola con el importe, pero con freno: cada tecleo no tiene por qué ser
    // una consulta, y sin `debounce` el listado de líneas parpadea mientras se escribe.
    toObservable(
      computed(() => ({
        accountUuid: this.selectedAccountUuid(),
        amount: this.paymentsTotal(),
      })),
    )
      .pipe(
        debounceTime(300),
        switchMap(({ accountUuid, amount }) => {
          if (!accountUuid || amount <= 0) {
            this.previewLoading.set(false);
            return of(null);
          }
          this.previewLoading.set(true);
          return this.api.previewAllocation(accountUuid, amount);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.previewLoading.set(false);
        },
        // Una previa que falla no bloquea el cobro: es información, no una validación.
        error: () => {
          this.preview.set(null);
          this.previewLoading.set(false);
        },
      });
  }

  ngOnInit(): void {
    this.api
      .paymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => {
        this.paymentMethods.set(methods);
        // El primer medio arranca elegido: en el mostrador el caso común es efectivo y una sola
        // línea, y obligar a abrir el desplegable para eso es fricción sin ganancia.
        this.payments.update((rows) =>
          rows.map((row) =>
            row.paymentMethodUuid ? row : { ...row, paymentMethodUuid: methods[0]?.uuid ?? '' },
          ),
        );
      });

    // Una sola lectura del listado: el selector de titular es un desplegable, no un buscador
    // paginado. Con una cartera grande esto pasaría a ser el `customer-picker` del core.
    this.api
      .paginateAccounts({ page: 1, size: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((page) => {
        this.accounts.set(page.content ?? []);

        const requested = this.route.snapshot.queryParamMap.get('account');
        if (requested && (page.content ?? []).some((account) => account.uuid === requested)) {
          this.onAccountChange(requested);
        }
      });

    // La caja la resuelve el backend a partir de la preasignación del usuario; el front obedece.
    this.api
      .cashRegisterEntryContext()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (context) => {
          this.cashRegisterUuid.set(context.cashRegister?.uuid ?? null);
          this.cashSessionOpen.set(hasOpenSession(context.cashRegister ?? null));
        },
        error: () => {
          this.cashRegisterUuid.set(null);
          this.cashSessionOpen.set(null);
        },
      });
  }

  protected onAccountChange(uuid: string): void {
    this.selectedAccountUuid.set(uuid);
    this.manualAmounts.set({});
    this.modeChosen = false;
    this.loadOpenDebts(uuid);
    this.loadConfiguredMode(uuid);
  }

  /**
   * Las deudas abiertas del titular, para el reparto a mano.
   *
   * Van en orden de vencimiento, el mismo del FIFO, para que elegir a mano parta de lo que el
   * sistema haría solo. Sin `states` el backend devuelve las abiertas, que son las únicas contra las
   * que se puede imputar.
   */
  private loadOpenDebts(accountUuid: string): void {
    this.api
      .paginateDebts(accountUuid, { page: 1, size: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.openDebts.set(page.content ?? []),
        error: () => this.openDebts.set([]),
      });
  }

  /**
   * El modo de imputación que rige para el titular, para ofrecerlo primero.
   *
   * Es el `resolved` de su política, el mismo que mira el backend para decidir si corre el FIFO. Si
   * la lectura falla o trae algo que no es uno de los dos modos no se adivina: queda sin saber, y la
   * pantalla sigue con el orden de siempre.
   */
  private loadConfiguredMode(accountUuid: string): void {
    this.api
      .getAccountPolicy(accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (policy) =>
          this.applyConfiguredMode(
            accountUuid,
            allocationChoiceOf(policy.resolved?.allocationMode),
          ),
        error: () => this.applyConfiguredMode(accountUuid, null),
      });
  }

  private applyConfiguredMode(accountUuid: string, mode: AllocationChoice | null): void {
    // La respuesta de un titular que ya no es el elegido llegó tarde y no decide nada.
    if (this.selectedAccountUuid() !== accountUuid) {
      return;
    }
    this.configuredMode.set(mode);
    if (!this.modeChosen) {
      this.allocationMode.set(mode ?? 'AUTO');
    }
  }

  protected onAllocationModeChange(mode: AllocationChoice): void {
    this.modeChosen = true;
    this.allocationMode.set(mode);
    // Pasar a manual arranca del reparto que el FIFO haría: es de donde parte cualquier corrección.
    if (mode === 'MANUAL' && Object.keys(this.manualAmounts()).length === 0) {
      this.onSplitByFifo();
    }
  }

  protected onManualAmountChange(debtUuid: string, value: string): void {
    const parsed = Number(value);
    const amount = Number.isFinite(parsed) && parsed > 0 ? round(parsed) : null;
    this.manualAmounts.update((current) => ({ ...current, [debtUuid]: amount }));
  }

  /**
   * Volver a repartir por FIFO.
   *
   * Es un botón y no un modo escondido: es la salida cuando el reparto a mano se enredó. Copia lo
   * que propone la previa, que la calcula la misma función del backend que después escribe las
   * filas.
   */
  protected onSplitByFifo(): void {
    const lines = this.preview()?.lines ?? [];
    const next: Record<string, number | null> = {};
    for (const line of lines) {
      next[line.debtUuid] = line.amount;
    }
    this.manualAmounts.set(next);
  }

  protected onDateChange(value: Date | null): void {
    if (value) {
      this.dateIssued.set(value);
    }
  }

  protected onPaymentMethodChange(id: number, paymentMethodUuid: string): void {
    this.payments.update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, paymentMethodUuid } : row)),
    );
  }

  protected onPaymentAmountChange(id: number, value: string): void {
    const parsed = Number(value);
    const amount = Number.isFinite(parsed) && parsed > 0 ? round(parsed) : null;
    this.payments.update((rows) => rows.map((row) => (row.id === id ? { ...row, amount } : row)));
  }

  protected onAddPayment(): void {
    this.payments.update((rows) => [
      ...rows,
      {
        id: this.nextPaymentId++,
        paymentMethodUuid: this.paymentMethods()[0]?.uuid ?? '',
        amount: null,
      },
    ]);
  }

  /** Si el medio de esta línea genera movimiento de caja. Se marca en la fila, no al confirmar. */
  protected affectsCashRegister(paymentMethodUuid: string): boolean {
    return (
      this.paymentMethods().find((method) => method.uuid === paymentMethodUuid)
        ?.affectsCashRegister ?? false
    );
  }

  protected onRemovePayment(id: number): void {
    if (this.payments().length === 1) {
      return;
    }
    this.payments.update((rows) => rows.filter((row) => row.id !== id));
  }

  /** Cancelar vuelve al listado, que es de donde se llega acá con o sin titular elegido. */
  protected onCancel(): void {
    void this.router.navigateByUrl(CHECKING_ACCOUNTS_PATH);
  }

  /** Las líneas con importe, que son las únicas que el backend tiene que escribir. */
  private manualAllocations(): readonly AllocationInput[] {
    return Object.entries(this.manualAmounts())
      .filter(([, amount]) => (amount ?? 0) > 0)
      .map(([debtUuid, amount]) => ({ debtUuid, amount: amount as number }));
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    const account = this.selectedAccount();
    if (!this.canSubmit() || !account) {
      return;
    }

    this.submitting.set(true);
    this.api
      .registerCredit({
        accountUuid: account.uuid,
        // La caja viaja sólo si hace falta: un cobro íntegramente por transferencia no pasa por
        // ninguna, y mandarla sería inventar el dato.
        cashRegisterUuid: this.touchesCashRegister()
          ? (this.cashRegisterUuid() ?? undefined)
          : undefined,
        // Para hoy no se manda: el backend la pone en «ahora», que es la hora que con seguridad
        // cae dentro de la sesión abierta. Para otra fecha se manda el mediodía —una hora
        // cualquiera del día que ocurrió—, porque la hora del reloj de ahora podría caer fuera de
        // la ventana de la sesión que cubre ese día.
        dateIssued: this.dateIsToday() ? undefined : `${toIsoDate(this.dateIssued())}T12:00:00.000`,
        description: this.description().trim() || undefined,
        payments: this.payments().map((payment) => ({
          paymentMethodUuid: payment.paymentMethodUuid,
          amount: payment.amount ?? 0,
        })),
        // El reparto viaja en el mismo request. **Su ausencia no significa «no imputar»**: sin él
        // corre el FIFO, y con él el FIFO no corre y lo que sobre queda a favor del titular.
        allocations: this.allocationMode() === 'MANUAL' ? this.manualAllocations() : undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (credit) => {
          this.submitting.set(false);
          this.toast.success(
            this.translate.instant('checkingAccounts.toasts.collectionDone', {
              // El número del recibo es lo que alguien anota o busca después; cuántas deudas cubrió
              // ya se ve en la ficha a la que la pantalla navega.
              publicId: credit.publicId,
            }),
          );
          void this.router.navigateByUrl(checkingAccountPath(account.uuid));
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.toast.error(
            error instanceof Error && error.message
              ? error.message
              : this.translate.instant('checkingAccounts.toasts.collectionError'),
          );
        },
      });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** El modo de la política en el vocabulario del selector. Cualquier otro valor es no saber cuál rige. */
function allocationChoiceOf(mode: string | null | undefined): AllocationChoice | null {
  if (mode === 'AUTOMATIC') {
    return 'AUTO';
  }
  return mode === 'MANUAL' ? 'MANUAL' : null;
}
