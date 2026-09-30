import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, of } from 'rxjs';
import { PANEL_HOME_ROUTE } from '../../../../core/auth/auth.paths';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfigurationStore } from '../../../../core/configuration/configuration.store';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { CustomerPickerService } from '../../../../core/customer-picker/customer-picker.service';
import { FullscreenService } from '../../../../core/layout/fullscreen.service';
import { LayoutService } from '../../../../core/layout/layout.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { CashSessionChipComponent } from '../../components/cash-session-chip/cash-session-chip.component';
import {
  CartPackagingChange,
  CartPriceListChange,
  CartQuantityChange,
  CartSerialRemove,
  SaleCartComponent,
} from '../../components/sale-cart/sale-cart.component';
import {
  BatchPickerDialogComponent,
  BatchPickerDialogData,
  BatchPickerDialogResult,
} from '../../components/batch-picker-dialog/batch-picker-dialog.component';
import {
  SerialPickerDialogComponent,
  SerialPickerDialogData,
  SerialPickerDialogResult,
} from '../../../../core/stock/serial-picker-dialog/serial-picker-dialog.component';
import { Permissions } from '../../../../core/auth/permissions';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import {
  SalePaymentDialogComponent,
  SalePaymentDialogData,
  SalePaymentDialogResult,
} from '../../components/sale-payment-dialog/sale-payment-dialog.component';
import {
  ProductScanned,
  SaleProductSearchComponent,
} from '../../components/sale-product-search/sale-product-search.component';
import { SaleLineActionsComponent } from '../../components/sale-line-actions/sale-line-actions.component';
import {
  SaleQuantityDialogComponent,
  SaleQuantityDialogData,
  SaleQuantityDialogResult,
} from '../../components/sale-quantity-dialog/sale-quantity-dialog.component';
import { SaleShortcutsComponent } from '../../components/sale-shortcuts/sale-shortcuts.component';
import { SaleTotalsComponent } from '../../components/sale-totals/sale-totals.component';
import {
  StockShortageDialogComponent,
  StockShortageDialogData,
  StockShortageDialogResult,
} from '../../components/stock-shortage-dialog/stock-shortage-dialog.component';
import {
  CASH_REGISTER_OPEN_PERMISSION,
  CashRegisterDto,
  branchCashRegisters,
  hasOpenSession,
  withOpenSession,
} from '../../../../core/cash-session/cash-session.model';
import { CashSessionService } from '../../../../core/cash-session/cash-session.service';
import {
  isSameLocalDay,
  toLocalDateTime,
  toLocalDateTimeInput,
} from '../../../../core/orders/local-date-time';
import {
  ORDER_OBSERVATIONS_MAX_LENGTH,
  OrderCommitPayload,
  OrderDto,
  StockShortageDetail,
  readStockValidationWarning,
  readExpiredBatchError,
} from '../../../../core/orders/order-commit.model';
import {
  AccountAvailabilityDto,
  readAccountDebtLimit,
} from '../../../../core/checking-accounts/account-availability.model';
import { AccountAvailabilityService } from '../../../../core/checking-accounts/account-availability.service';
import { AccountPanelComponent } from '../../../../core/checking-accounts/account-panel/account-panel.component';
import {
  AccountOverrideDialogComponent,
  AccountOverrideDialogData,
  AccountOverrideDialogResult,
} from '../../../../core/checking-accounts/account-override-dialog/account-override-dialog.component';
import { OrdersApiService } from '../../../../core/orders/orders-api.service';
import { formatDocument } from '../../../../core/parties/party.model';
import {
  ACCOUNT_OVERRIDE_LIMIT_PERMISSION,
  BLOCKING_SALE_CATALOGS,
  SALE_CREATE_PERMISSION,
  SaleCatalogName,
  SalePaymentMethodDto,
  SalePriceListDto,
  SaleProductDto,
  SaleVoucherDto,
  SaleCartLineView,
  SaleBlockingReason,
  isBatchTracked,
  isSerialTracked,
  isVirtualKitProduct,
} from '../../data-access/sale.model';
import { HasPendingSale } from '../../data-access/pos-exit.guard';
import { SALE_SHORTCUTS } from '../../data-access/sale-shortcuts';
import { SalesCatalogApiService } from '../../data-access/sales-catalog-api.service';
import { SelectedCashRegisterStore } from '../../../../core/cash-session/selected-cash-register.store';
import { DirectSaleCart } from '../../state/direct-sale-cart';

/**
 * Cada cuánto se refresca el reloj de la barra. Medio minuto: el dato es la hora y no el segundero,
 * y un temporizador por segundo despierta la pantalla sesenta veces para pintar lo mismo.
 */
const CLOCK_REFRESH_MS = 30_000;

/**
 * Las excepciones que el operador fue autorizando en esta venta.
 *
 * Se acumulan y viajan juntas porque una venta puede necesitar las dos, y en ese orden: se confirma
 * el faltante de stock, el commit vuelve rechazado por límite de cuenta, se autoriza el exceso, y el
 * reenvío tiene que seguir llevando la confirmación del stock. Con una sola bandera por vuelta, el
 * operador contestaría la misma pregunta dos veces.
 */
interface CommitOverrides {
  /** El faltante de stock, ya confirmado. */
  confirmStock: boolean;
  /** El despacho de un lote vencido, ya confirmado (sólo con `stock.expiredPolicy = WARN`). */
  confirmExpired: boolean;
  /** El motivo con el que se autorizó pasar el límite de cuenta corriente. `null` = no se autorizó. */
  accountReason: string | null;
}

/** Una venta que todavía no necesitó que nadie autorice nada, que es como arrancan todas. */
const NO_OVERRIDES: CommitOverrides = {
  confirmStock: false,
  confirmExpired: false,
  accountReason: null,
};

/**
 * Punto de venta: se arma el carrito, se elige a quién y con qué comprobante, se cobra y se cierra.
 *
 * Toda la operación vive en memoria hasta el final. `POST /order/commit` la persiste entera —orden,
 * líneas, comprobante, pagos y movimientos de stock— o no persiste nada: no hay borradores, así que
 * un error deja el carrito intacto y se puede reintentar tal cual está.
 *
 * Los importes que muestra son una anticipación de los que calculará el backend (ver
 * `sale-pricing.ts`); los definitivos son los que devuelve el commit y son los que se informan al
 * confirmar.
 */
@Component({
  selector: 'app-direct-sale-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    AccountPanelComponent,
    CashSessionChipComponent,
    LoadStateComponent,
    SaleCartComponent,
    SaleLineActionsComponent,
    SaleProductSearchComponent,
    SaleShortcutsComponent,
    SaleTotalsComponent,
  ],
  providers: [OrdersApiService, SalesCatalogApiService, AccountAvailabilityService],
  templateUrl: './direct-sale.page.html',
  styleUrl: './direct-sale.page.css',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class DirectSalePage implements OnInit, HasPendingSale {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly catalogApi = inject(SalesCatalogApiService);
  private readonly selectedCashRegister = inject(SelectedCashRegisterStore);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly configuration = inject(ConfigurationStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cashSession = inject(CashSessionService);
  private readonly customerPicker = inject(CustomerPickerService);
  private readonly accountAvailability = inject(AccountAvailabilityService);
  private readonly injector = inject(Injector);
  private readonly layout = inject(LayoutService);
  protected readonly fullscreen = inject(FullscreenService);
  private readonly router = inject(Router);

  private readonly productSearch = viewChild(SaleProductSearchComponent);

  /**
   * El panel de la línea marcada. La pantalla lo necesita para abrirle el menú de listas con la
   * tecla: el teclado del punto de venta se atiende en un solo lugar, y el menú lo tiene él.
   */
  private readonly lineActions = viewChild(SaleLineActionsComponent);

  protected readonly cart = new DirectSaleCart();

  /**
   * Una venta a medio armar, que es lo que `posExitGuard` pregunta antes de dejar salir. Público a
   * propósito: el guard lo lee desde afuera del componente.
   *
   * Son las líneas y la nota. El cliente, el comprobante y la caja arrancan elegidos solos, así que
   * tomarlos como venta empezada haría preguntar al salir de una pantalla en la que no se hizo nada;
   * la nota, en cambio, la escribió alguien, y salir sin avisar la perdería.
   */
  readonly hasPendingSale = computed(
    () => !this.cart.isEmpty() || this.cart.observations().length > 0,
  );

  protected readonly canSell = this.auth.hasPermission(SALE_CREATE_PERMISSION);

  /**
   * Elegir a mano de qué lote sale una línea (§7.3). Sin el permiso el lote se ve pero no se
   * cambia: la política de la sucursal lo asigna al cerrar.
   */
  protected readonly canSelectBatch = this.auth.hasPermission(Permissions.stockBatchSelect);

  /**
   * `checking_account.override_limit`: quién puede autorizar una venta que deja al cliente por
   * encima de su tope. Sin él la excepción **no se ofrece** —el rechazo se informa y ahí termina—,
   * porque preguntar un motivo para después mostrar un 403 es hacerle escribir al cajero algo que
   * nadie va a leer.
   */
  private readonly canOverrideAccountLimit = this.auth.hasPermission(
    ACCOUNT_OVERRIDE_LIMIT_PERMISSION,
  );

  protected readonly catalogsState = signal(LoadState.Loading);
  /**
   * Los catálogos que no cargaron. Que uno falle no tumba la pantalla —cada uno cae a su vacío—, pero
   * tampoco se calla: un 403 en los comprobantes dejaba al vendedor frente a «Elegí el comprobante» sin
   * ningún comprobante que elegir y sin saber por qué.
   */
  protected readonly failedCatalogs = signal<readonly SaleCatalogName[]>([]);
  protected readonly submitting = signal(false);

  protected readonly vouchers = signal<readonly SaleVoucherDto[]>([]);
  /** Las mismas listas que usa el carrito para el precio; la columna «Lista» las ofrece. */
  protected readonly priceLists = signal<readonly SalePriceListDto[]>([]);
  protected readonly paymentMethods = signal<readonly SalePaymentMethodDto[]>([]);
  protected readonly cashRegisters = signal<readonly CashRegisterDto[]>([]);
  protected readonly cashRegisterUuid = signal<string | null>(null);

  /** `cash_register.open`: sin él el chip informa la caja cerrada pero no ofrece abrirla. */
  protected readonly canOpenCashSession = this.auth.hasPermission(CASH_REGISTER_OPEN_PERMISSION);
  protected readonly openingCashSession = signal(false);

  /**
   * El estado de la cuenta corriente del cliente, tal como lo resolvió el backend.
   *
   * **Se pide al elegir el cliente y no al cobrar** (§10.1): enterarse de que está excedido después
   * de cargar veinte artículos es la peor versión de esta funcionalidad. `null` mientras no hay
   * cliente, o cuando la lectura falló —un titular sin cuenta responde 404— y en ese caso la pantalla
   * simplemente no afirma nada sobre su cuenta.
   */
  protected readonly availability = signal<AccountAvailabilityDto | null>(null);

  /**
   * El titular no tiene cuenta corriente: un 404, que no es un error. El panel lo dice en vez de
   * quedarse en blanco — «no puede llevar nada» y «no hay a quién preguntarle» no son lo mismo.
   */
  protected readonly noAccount = signal(false);
  protected readonly availabilityLoading = signal(false);

  /**
   * Si ya se intentó cobrar. Es lo que destapa el aviso de lo que falta: mientras nadie lo pidió, la
   * pantalla de una venta recién empezada no tiene por qué estar reclamando nada.
   */
  private readonly chargeAttempted = signal(false);

  /** Productos cuya regla de precio ya se pidió, se haya resuelto o no: no se vuelve a preguntar. */
  private readonly roundingRequested = new Set<string>();

  /** Kits cuya composición ya se pidió. Mismo criterio: una lectura por producto y por pantalla. */
  private readonly kitRequested = new Set<string>();

  protected readonly cashRegister = computed(
    () => this.cashRegisters().find((item) => item.uuid === this.cashRegisterUuid()) ?? null,
  );

  /**
   * Si la fecha de la venta cae hoy, que es lo normal en un mostrador.
   *
   * Es lo que decide qué puede anticipar la pantalla sobre la sesión de caja: el backend acepta una
   * sesión **abierta del mismo día calendario** o una **cerrada cuyo intervalo contenga** el
   * instante. De las abiertas se entera el front —vienen en el listado de cajas—; de las cerradas
   * no, así que para una fecha anterior no hay nada que verificar de este lado.
   */
  protected readonly isToday = computed(() =>
    isSameLocalDay(this.cart.dateOperation(), new Date()),
  );

  /**
   * Si la caja alcanza para abrir el cobro.
   *
   * Con la venta de hoy se exige sesión abierta: sin ella el commit responde 400 y no tiene sentido
   * dejar armar el cobro. Con una fecha anterior alcanza con tener una caja elegida —puede haber una
   * sesión cerrada que cubra ese instante y el front no tiene cómo saberlo—, así que se manda y, si
   * ninguna aplica, se muestra el 400 del backend. Cortar acá impediría justamente lo que la fecha
   * editable viene a habilitar: registrar una venta que quedó sin cargar antes del cierre.
   */
  protected readonly cashSessionReady = computed(() =>
    this.isToday() ? hasOpenSession(this.cashRegister()) : this.cashRegister() !== null,
  );

  /** El valor con el que se pinta el campo: `YYYY-MM-DDTHH:mm` en hora local, sin `Z`. */
  protected readonly dateOperationValue = computed(() =>
    toLocalDateTimeInput(this.cart.dateOperation()),
  );

  /** Lo que acepta `orders.observations`: el campo corta ahí en vez de esperar el 400. */
  protected readonly observationsMaxLength = ORDER_OBSERVATIONS_MAX_LENGTH;

  /**
   * Todo lo que le falta a la venta para poder cobrarse, junto y en el orden en que conviene
   * resolverlo: primero lo que bloquea la pantalla entera (permiso, caja), después lo que le falta a
   * esta venta. Vacío significa que se puede abrir el cobro.
   *
   * El faltante de stock **no** está en la lista: es una decisión, no un dato que falte, y quien la
   * pide es el diálogo que se abre al cobrar. Los pagos tampoco: son justamente lo que se va a
   * registrar a continuación.
   */
  protected readonly missingRequirements = computed<readonly SaleBlockingReason[]>(() => {
    const missing: SaleBlockingReason[] = [];

    if (!this.canSell) {
      missing.push('sales.blocked.permission');
    }

    if (this.failedCatalogs().some((name) => BLOCKING_SALE_CATALOGS.includes(name))) {
      missing.push('sales.blocked.catalogs');
    }

    if (this.cashRegister() === null) {
      missing.push('sales.blocked.cashRegister');
    } else if (!this.cashSessionReady()) {
      missing.push('sales.blocked.cashSession');
    }

    if (this.cart.isEmpty()) {
      missing.push('sales.blocked.emptyCart');
    }

    if (this.cart.unsellableLines().length > 0) {
      missing.push('sales.blocked.unsellable');
    }

    if (this.cart.linesWithBatchIssues().length > 0) {
      missing.push('sales.blocked.batch');
    }

    // Qué serie falta y de qué producto, en palabras: el mostrador tiene que poder resolverlo sin
    // buscar la línea roja en un carrito de diez.
    const missingSerials = this.cart.linesWithSerialIssues();
    if (missingSerials.length > 0) {
      const first = missingSerials[0];
      missing.push({
        key: first.serialShortage === 1 ? 'sales.blocked.serialsOne' : 'sales.blocked.serialsMany',
        params: { count: first.serialShortage, name: first.product.name },
      });
    }

    if (this.cart.voucher() === null) {
      missing.push('sales.blocked.voucher');
    }

    return missing;
  });

  /** Lo que ve el operador: la lista aparece recién cuando intentó cobrar, y se va sola al resolverse. */
  protected readonly chargeAlert = computed<readonly SaleBlockingReason[]>(() =>
    this.chargeAttempted() ? this.missingRequirements() : [],
  );

  /** Las teclas de la pantalla, tal como las escribe la leyenda del pie y cada botón. */
  protected readonly shortcuts = SALE_SHORTCUTS;

  /** Quién está vendiendo, para la barra. Es el usuario de la sesión: el commit imputa a él. */
  protected readonly sellerName = computed(() => this.auth.authUser()?.username ?? '');

  /** La hora del mostrador, en la barra y al lado del vendedor. */
  protected readonly clock = signal('');

  /**
   * Cuántas unidades hay cargadas en total, que no es lo mismo que cuántas líneas: es el número con
   * el que el cajero controla que no escaneó dos veces lo mismo.
   */
  protected readonly unitCount = computed(() => {
    const total = this.cart.lineViews().reduce((sum, line) => sum + line.quantity, 0);

    // Sumar cantidades con decimales —tres productos de 0,1 kg— deja el ruido del punto flotante
    // pegado al número, y el recuento se pinta tal cual sale. Se corta en la precisión más fina que
    // acepta una línea, que es la del gramo.
    return Math.round(total * 1000) / 1000;
  });

  /**
   * La línea sobre la que actúan las teclas.
   *
   * Se deriva del carrito para sobrevivirle a lo que le pase: quitar una línea deja marcada a la
   * que ocupó su lugar —y no a ninguna, que obligaría a volver a elegir con la flecha después de
   * cada `Supr`— y vaciar el carrito la suelta. Se escribe además a mano al escanear, porque lo que
   * se acaba de cargar es lo que se va a corregir.
   */
  protected readonly activeUuid = linkedSignal<readonly SaleCartLineView[], string | null>({
    source: this.cart.lineViews,
    computation: (lines, previous) => {
      const chosen = previous?.value ?? null;

      if (lines.length === 0) {
        return null;
      }

      if (chosen && lines.some((line) => line.product.uuid === chosen)) {
        return chosen;
      }

      // La que quedó en el lugar de la que se fue. Sin línea previa —la primera del carrito— es la
      // primera, que es también lo que sale de un índice `-1` clampeado.
      const previousIndex =
        previous?.source.findIndex((line) => line.product.uuid === chosen) ?? -1;

      return lines[Math.min(Math.max(previousIndex, 0), lines.length - 1)].product.uuid;
    },
  });

  protected readonly activeLine = computed(
    () => this.cart.lineViews().find((line) => line.product.uuid === this.activeUuid()) ?? null,
  );

  /** Qué número de fila es la marcada, para nombrarla igual que la columna «#» del carrito. */
  protected readonly activeIndex = computed(() =>
    this.cart.lineViews().findIndex((line) => line.product.uuid === this.activeUuid()),
  );

  /**
   * Con quién está armada la venta: el nombre y, si tiene, el documento.
   *
   * **Vacío es un estado final, no uno pendiente.** La venta de mostrador no tiene tercero y no lo
   * necesita: no hay ficha que abrir ni fila sentinela que elegir —la unificación de terceros se
   * llevó puesto el `Consumidor Final` que existía sólo para llenar este campo—, así que el cobro
   * no lo exige. Lo que sí exige un tercero es pagar con cuenta corriente, y eso se valida al
   * elegir el medio de pago, que es donde el operador puede hacer algo al respecto.
   */
  protected readonly customerLabel = computed(() => {
    const customer = this.cart.customer();
    if (!customer) {
      return '';
    }

    const document = formatDocument(customer);
    return document === '—' ? customer.name : `${customer.name} · ${document}`;
  });

  protected readonly LoadState = LoadState;

  constructor() {
    // El mostrador es una pantalla de trabajo, no una de consulta: el cromo del panel acá es alto
    // que se le quita al carrito. Se suelta solo al salir de la pantalla.
    this.layout.requestImmersive();

    // La pantalla completa del navegador no se toma sola: la pide el botón de la barra, que es el
    // gesto del usuario que la API exige. Devolverla al salir sí es cosa de la pantalla —la tomó el
    // punto de venta y con el punto de venta se va—, y así se devuelve también cuando se sale por el
    // Atrás del navegador o por un link y no por el botón.
    this.destroyRef.onDestroy(() => this.fullscreen.exit());

    // El guard cubre las salidas que pasan por el router; recargar o cerrar la pestaña no pasa por
    // él y se lleva el carrito igual, así que ese aviso lo pone el navegador.
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!this.hasPendingSale()) {
        return;
      }

      // El navegador muestra su propio texto e ignora el nuestro, pero `preventDefault` y
      // `returnValue` siguen siendo necesarios para que el aviso aparezca en todos.
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    this.destroyRef.onDestroy(() => window.removeEventListener('beforeunload', onBeforeUnload));

    // El panel del titular se pide apenas hay cliente, y no al abrir el cobro. Va en un efecto y no
    // dentro de `onPickCustomer` para que valga por cualquier camino que lo cambie: hoy es el
    // selector, y el día que la venta arranque con un cliente ya elegido —una orden que se retoma—
    // el panel va a estar igual.
    effect(() => this.loadAvailability(this.cart.customer()?.uuid ?? null));

    // El reloj de la barra. Se pinta de entrada para que no arranque vacío y después se refresca
    // solo; el temporizador se apaga con la pantalla.
    this.tickClock();
    const clockTimer = setInterval(() => this.tickClock(), CLOCK_REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(clockTimer));
  }

  private tickClock(): void {
    this.clock.set(
      new Intl.DateTimeFormat(this.language.localeId(), {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date()),
    );
  }

  /**
   * Trae la decisión del portón para este titular. **Sin importe**: la pregunta de este momento es
   * «¿puede llevar algo a cuenta?», que es lo que el panel contesta antes de que se cargue nada.
   *
   * Un error no se informa con un cartel: que el cliente no tenga cuenta corriente —un 404— es
   * normal, y taparle el mostrador al cajero con un toast por algo que no le impide vender sería
   * ruido. Lo que sí hace es dejar el panel vacío, que es la forma honesta de no afirmar nada.
   */
  private loadAvailability(partyRoleUuid: string | null): void {
    this.availability.set(null);
    this.noAccount.set(false);

    if (!partyRoleUuid) {
      this.availabilityLoading.set(false);
      return;
    }

    this.availabilityLoading.set(true);

    this.accountAvailability
      .forPartyRole(partyRoleUuid, 'SALE')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (availability) => {
          this.availabilityLoading.set(false);
          // Puede haber cambiado de cliente mientras la respuesta viajaba: la de un titular que ya
          // no es el de la venta pintaría el saldo de otra persona.
          if (this.cart.customer()?.uuid === partyRoleUuid) {
            this.availability.set(availability);
          }
        },
        error: (error: unknown) => {
          this.availabilityLoading.set(false);
          this.availability.set(null);
          // Sólo el 404 significa «no tiene cuenta». Cualquier otro error deja el panel en blanco:
          // afirmar que no tiene cuenta porque el servidor falló sería inventar un dato.
          this.noAccount.set(error instanceof HttpErrorResponse && error.status === 404);
        },
      });
  }

  ngOnInit(): void {
    this.loadCatalogs();
  }

  /**
   * Deja el punto de venta y vuelve al inicio.
   *
   * Salir del modo es salir de la pantalla, no destapar el menú encima de ella: mientras el POS
   * está abierto se está atendiendo a alguien, y media aplicación asomando sobre el carrito es un
   * estado intermedio que no sirve para nada. La pantalla completa del navegador la devuelve el
   * `onDestroy`, y del carrito cargado se ocupa `posExitGuard`: navegar y que el guard pregunte
   * cubre también al Atrás del navegador, que no pasa por este botón.
   */
  protected onExit(): void {
    void this.router.navigateByUrl(PANEL_HOME_ROUTE);
  }

  /**
   * Entra o sale de la pantalla completa del navegador.
   *
   * Devuelve el foco al campo de carga: la pantalla completa se aprieta una vez por turno y lo que
   * sigue siempre es escanear, así que dejar el foco en el botón obligaría a un clic de más.
   */
  protected onToggleFullscreen(): void {
    this.fullscreen.toggle();
    this.productSearch()?.focus();
  }

  protected loadCatalogs(): void {
    this.catalogsState.set(LoadState.Loading);

    // Cada catálogo cae a su vacío en vez de tumbar la pantalla: sin clientes se vende igual
    // (queda el consumidor final del backend), sin medios de pago no, pero eso se dice en su lugar. Y
    // se anota cuál falló, para decirlo arriba de la pantalla en vez de dejar un select vacío.
    const failed: SaleCatalogName[] = [];
    const fallen = (name: SaleCatalogName) => {
      failed.push(name);
      return of([]);
    };
    forkJoin({
      priceLists: this.catalogApi.getPriceLists().pipe(catchError(() => fallen('priceLists'))),
      customers: this.catalogApi.getCustomers().pipe(catchError(() => fallen('customers'))),
      vouchers: this.catalogApi.getVouchers().pipe(catchError(() => fallen('vouchers'))),
      paymentMethods: this.catalogApi
        .getPaymentMethods()
        .pipe(catchError(() => fallen('paymentMethods'))),
      cashRegisters: this.catalogApi
        .getCashRegisters()
        .pipe(catchError(() => fallen('cashRegisters'))),
      entryContext: this.catalogApi.getCashRegisterEntryContext().pipe(catchError(() => of(null))),
      // Las dos lecturas de las promociones caen a su vacío como las demás, y con la misma
      // consecuencia acotada: sin promociones el carrito muestra el precio de lista, que es
      // exactamente lo que mostraba antes de que este módulo existiera. Sin el árbol de categorías
      // siguen aplicando las promociones cargadas por producto puntual.
      promotions: this.catalogApi.getPromotions().pipe(catchError(() => of([]))),
      categoryChains: this.catalogApi
        .getCategoryChains()
        .pipe(catchError(() => of(new Map<string, readonly string[]>()))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (catalogs) => {
          this.failedCatalogs.set(failed);
          this.cart.setStockValidationPolicy(this.configuration.stockValidationPolicy());
          this.cart.setPriceLists(catalogs.priceLists);
          this.cart.setCategoryChains(catalogs.categoryChains);
          this.cart.setPromotions(catalogs.promotions);
          // La sucursal activa: contra ella se filtran las promociones restringidas a sucursales
          // puntuales. Es la misma con la que el paginado acotó el catálogo de productos.
          this.cart.setBranch(this.auth.selectedBranchUuid());

          this.priceLists.set(catalogs.priceLists);
          this.vouchers.set(catalogs.vouchers);
          this.paymentMethods.set(catalogs.paymentMethods);
          const cashRegisters = branchCashRegisters(
            catalogs.cashRegisters,
            this.auth.selectedBranchUuid(),
          );
          this.cashRegisters.set(cashRegisters);

          // Sin cliente por defecto: el mostrador arranca en consumidor final, que ahora es
          // literalmente ningún tercero.
          this.cart.setCustomer(null);
          this.cart.setVoucher(pickDefaultVoucher(catalogs.vouchers));
          this.useCashRegister(
            this.resolveCashRegisterUuid(
              cashRegisters,
              catalogs.entryContext?.cashRegister?.uuid ?? null,
            ),
          );

          this.catalogsState.set(LoadState.Success);
          this.focusSearch();
        },
        error: () => this.catalogsState.set(LoadState.Error),
      });
  }

  /**
   * Deja el cursor en el buscador, que es donde empieza el trabajo: se entra a la pantalla y se pasa
   * el primer producto por el lector, sin un clic en el medio.
   *
   * Va después del render y no en el acto: mientras carga, `app-load-state` no proyecta el
   * contenido, así que el campo existe pero está fuera del documento —y enfocar algo desconectado no
   * hace nada—. Recién cuando el estado pasa a `Success` y Angular lo inserta hay dónde poner el
   * foco.
   */
  private focusSearch(): void {
    afterNextRender(() => this.productSearch()?.focus(), { injector: this.injector });
  }

  /**
   * Entra mercadería al carrito. La `quantity` viene resuelta por quien leyó el código: `1` en una
   * elección de la lista, el peso de la etiqueta de balanza, o las unidades que trae la caja. El
   * carrito guarda siempre unidad base (RN-16), así que acá no hay nada que convertir.
   */
  protected onProductSelected({
    product,
    quantity,
    packaging,
    quantityFromCode,
    serial,
  }: ProductScanned): void {
    // Una lectura de número de serie identifica **la unidad**: la línea entra con esa serie ya
    // elegida y el operador no la vuelve a buscar en el selector, que es todo el punto de haber
    // escaneado la etiqueta de la caja.
    if (serial) {
      this.cart.addSerial(product, serial);
    } else {
      this.cart.addProduct(product, quantity, packaging, quantityFromCode);
    }

    // Lo que se acaba de cargar queda marcado: es lo que se va a corregir con las teclas, y es
    // también la línea que hay que mirar para ver si entró con el precio y la cantidad esperados.
    this.activeUuid.set(product.uuid);
    this.loadProductRounding(product.uuid);
    this.loadKitComposition(product);
  }

  /**
   * Qué trae el combo y para cuántos alcanza. Sólo se pide para los kits **virtuales** y una vez por
   * producto: el paginado no lo trae —derivarlo por fila sería una consulta por combo en cada
   * página— y en un mostrador el mismo combo se escanea muchas veces seguidas.
   *
   * Un kit armado no lo necesita: su disponible es su propio saldo, ya viene en la fila, y su
   * composición es la receta con la que se produce, no algo que la venta consuma (RN-22).
   *
   * Mientras no llega, la línea se dibuja sin desplegar y sin anticipar faltante: la explosión la
   * hace el backend en el commit con la composición vigente, y es quien valida cada componente.
   */
  private loadKitComposition(product: SaleProductDto): void {
    if (!isVirtualKitProduct(product) || this.kitRequested.has(product.uuid)) {
      return;
    }
    this.kitRequested.add(product.uuid);

    this.catalogApi
      .getKitInfo(product.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((kit) => {
        if (kit) {
          this.cart.setKitInfo(product.uuid, kit);
        }
      });
  }

  /** El empaque con el que se carga una línea, elegido en su fila. */
  protected onLinePackagingChange({ productUuid, packaging }: CartPackagingChange): void {
    this.cart.setLinePackaging(productUuid, packaging);
  }

  /**
   * Con qué criterio redondear los importes de este producto. Desde `v74` lo declara la regla de
   * precio que lo alcanza, no la sucursal, así que hay que resolverlo **por producto**: una regla
   * puede cerrar en múltiplos de 10 hacia arriba y la de al lado en dos decimales, y con el criterio
   * equivocado la pantalla le canta al cliente un precio que el comprobante no confirma.
   *
   * Se pide una sola vez por producto y por sesión de pantalla: en un mostrador el mismo artículo se
   * escanea muchas veces seguidas, y la regla no cambia entre escaneo y escaneo.
   */
  private loadProductRounding(productUuid: string): void {
    if (this.roundingRequested.has(productUuid)) {
      return;
    }
    this.roundingRequested.add(productUuid);

    this.catalogApi
      .getProductRounding(productUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((rounding) => {
        if (rounding) {
          this.cart.setProductRounding(productUuid, rounding);
        }
      });
  }

  protected onQuantityChange(change: CartQuantityChange): void {
    this.cart.setQuantity(change.productUuid, change.quantity);
  }

  /** Una línea, o las que el operador marcó para cambiarlas juntas. */
  protected onLinePriceListChange(change: CartPriceListChange): void {
    this.cart.setLinesPriceList(change.productUuids, change.priceListUuid);
  }

  /** El alcance más grueso: lo eligió el encabezado de la columna «Lista» del carrito. */
  protected onCartPriceListChange(priceListUuid: string | null): void {
    this.cart.setCartPriceList(priceListUuid);
  }

  protected onRemoveLine(productUuid: string): void {
    this.cart.removeLine(productUuid);
    this.productSearch()?.focus();
  }

  protected onRemoveLines(productUuids: readonly string[]): void {
    this.cart.removeLines(productUuids);
    this.productSearch()?.focus();
  }

  protected onClearCart(): void {
    this.cart.clearCart();
    this.productSearch()?.focus();
  }

  /**
   * Tira la venta entera y vuelve a empezar.
   *
   * Pregunta antes, a diferencia del tacho de cada fila: una línea se vuelve a escanear, un carrito
   * de veinte no. Lo que se pierde no está guardado en ninguna parte.
   */
  protected onCancelSale(): void {
    if (this.cart.isEmpty()) {
      return;
    }

    this.confirmDialog
      .confirm({
        title: this.translate.instant('sales.cancelSale.title'),
        // Dos claves y no un «(s)»: acá el número es el que hace dudar antes de apretar, y «las 1
        // líneas» le quita justamente el peso que tiene que tener.
        message: this.translate.instant(
          this.cart.itemCount() === 1
            ? 'sales.cancelSale.messageOne'
            : 'sales.cancelSale.messageMany',
          { count: this.cart.itemCount() },
        ),
        confirmLabel: this.translate.instant('sales.cancelSale.confirm'),
        cancelLabel: this.translate.instant('sales.cancelSale.cancel'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.onClearCart();
        } else {
          this.productSearch()?.focus();
        }
      });
  }

  // ── La línea marcada ──────────────────────────────────────────────────────────────────────────

  /**
   * Escribir la cantidad de la línea marcada de un tirón (`F5`).
   *
   * Los `+` y `−` de la fila corrigen de a una unidad; llevar una línea a doce con ellos son once
   * clics. El diálogo se abrió con una tecla, así que la mano ya está en el teclado.
   */
  protected onEditQuantity(): void {
    const line = this.activeLine();
    if (!line) {
      return;
    }

    this.dialog
      .open<SaleQuantityDialogComponent, SaleQuantityDialogData, SaleQuantityDialogResult>(
        SaleQuantityDialogComponent,
        { width: '20rem', maxWidth: '95vw', data: { line } },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((quantity) => {
        if (quantity !== undefined) {
          this.cart.setQuantity(line.product.uuid, quantity);
        }

        this.productSearch()?.focus();
      });
  }

  /** La lista con la que se valoriza la línea marcada, elegida desde su panel o con `F6`. */
  protected onActiveLinePriceList(priceListUuid: string | null): void {
    const line = this.activeLine();
    if (!line) {
      return;
    }

    this.cart.setLinesPriceList([line.product.uuid], priceListUuid);
    this.productSearch()?.focus();
  }

  /** El lote de la línea marcada. Sin partidas o sin permiso no hay nada que abrir. */
  protected onPickActiveBatch(): void {
    const line = this.activeLine();
    if (line?.batchTracked) {
      this.onBatchPick(line);
    }
  }

  /** Las unidades de la línea marcada. Sólo en un producto serializado. */
  protected onPickActiveSerials(): void {
    const line = this.activeLine();
    if (line?.serialTracked) {
      this.onSerialPick(line);
    }
  }

  protected onRemoveActiveLine(): void {
    const line = this.activeLine();
    if (line) {
      this.onRemoveLine(line.product.uuid);
    }
  }

  /**
   * Corre la marca una fila arriba o abajo. Se queda en los extremos en vez de dar la vuelta: en una
   * lista corta, saltar de la última a la primera se lee como que la tecla no anduvo.
   */
  private moveActive(step: number): void {
    const lines = this.cart.lineViews();
    if (lines.length === 0) {
      return;
    }

    const next = Math.min(Math.max(this.activeIndex() + step, 0), lines.length - 1);
    this.activeUuid.set(lines[next].product.uuid);
  }

  /**
   * Abre el selector de clientes y se queda con el elegido. Cerrarlo sin elegir no cambia nada: en
   * una venta ya armada, quedarse sin cliente sería peor que no haber abierto el diálogo.
   *
   * Cambiar de cliente recalcula el carrito entero —la lista preferida es otra— y suelta las listas
   * que se hubieran fijado a mano; de eso se ocupa el carrito.
   */
  protected onPickCustomer(): void {
    this.customerPicker
      .pick({ selectedUuid: this.cart.customer()?.uuid ?? null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((customer) => {
        if (customer) {
          this.cart.setCustomer(customer);
        }

        // Elegido o no, lo que sigue es escanear: el foco vuelve solo al buscador.
        this.productSearch()?.focus();
      });
  }

  /** Saca al cliente de la venta: vuelve a ser una venta de mostrador, sin tercero. */
  protected onClearCustomer(): void {
    this.cart.setCustomer(null);
    this.productSearch()?.focus();
  }

  protected onVoucherChange(uuid: string): void {
    this.cart.setVoucher(this.vouchers().find((voucher) => voucher.uuid === uuid) ?? null);
  }

  /**
   * La fecha que tipeó el operador. Se ignora lo que no es una fecha: el campo pasa por estados a
   * medio escribir mientras se tipea, y cada uno de esos llega como un `Invalid Date`.
   */
  protected onDateOperationChange(value: string): void {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    this.cart.setDateOperation(parsed);
  }

  protected onObservationsChange(observations: string): void {
    this.cart.setObservations(observations);
  }

  protected onCashRegisterChange(uuid: string): void {
    this.useCashRegister(uuid);
  }

  /**
   * Abre la sesión de la caja elegida sin salir de la pantalla.
   *
   * Con la sesión recién abierta alcanza con pisar la caja en la lista: es lo único que cambió.
   * El `alreadyOpen` es otra cosa —alguien la abrió mientras tanto— y ahí lo que corresponde es
   * releer los catálogos, porque lo que está desactualizado es la pantalla, no la caja.
   */
  protected onOpenCashSession(): void {
    const cashRegister = this.cashRegister();
    if (!cashRegister || this.openingCashSession()) {
      return;
    }

    this.openingCashSession.set(true);
    this.cashSession
      .open(cashRegister)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        this.openingCashSession.set(false);

        if (outcome.kind === 'opened') {
          this.cashRegisters.update((registers) =>
            withOpenSession(registers, cashRegister.uuid, outcome.session),
          );
        } else if (outcome.kind === 'alreadyOpen') {
          this.loadCatalogs();
        }
      });
  }

  /**
   * El teclado de la pantalla, desde donde sea que esté el foco: en un mostrador la mano está en el
   * lector o en el teclado, no en el mouse. Es lo que promete la leyenda del pie, y se atiende acá
   * —en un solo lugar— para que ninguna tecla haga dos cosas.
   *
   * Con un diálogo abierto no hace nada: o lo que abriría ya está en pantalla, o hay una decisión
   * pendiente encima y taparla sería peor. Con el foco dentro de un desplegable —un menú, un
   * selector— tampoco: esas teclas son de lo que está abierto, y robárselas deja al operador con un
   * menú que no responde.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    if (
      this.dialog.openDialogs.length > 0 ||
      this.catalogsState() !== LoadState.Success ||
      target?.closest('.cdk-overlay-container')
    ) {
      return;
    }

    const search = this.productSearch();
    const inSearch = search?.ownsTarget(event.target) ?? false;
    const inField =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    switch (event.key) {
      case SALE_SHORTCUTS.customer:
        event.preventDefault();
        this.onPickCustomer();
        return;

      case SALE_SHORTCUTS.quantity:
        event.preventDefault();
        this.onEditQuantity();
        return;

      case SALE_SHORTCUTS.priceList:
        event.preventDefault();
        this.lineActions()?.openPriceListMenu();
        return;

      case SALE_SHORTCUTS.batch:
        event.preventDefault();
        this.onPickActiveBatch();
        return;

      case SALE_SHORTCUTS.serials:
        event.preventDefault();
        this.onPickActiveSerials();
        return;

      case SALE_SHORTCUTS.charge:
        event.preventDefault();
        this.onCharge();
        return;

      case 'Escape':
        // Descarta la lectura que salió mal o el nombre a medio escribir, y vuelve al campo de
        // carga: es la tecla del «empecemos de nuevo» sin tocar el carrito.
        event.preventDefault();
        search?.reset();
        return;

      case 'ArrowDown':
      case 'ArrowUp':
        // Con el autocompletado desplegado las flechas eligen ahí adentro, que es donde está
        // mirando el operador.
        if (search?.isSuggesting()) {
          return;
        }

        // En el campo de carga las flechas no hacen nada útil —es de una sola línea—, así que son
        // del carrito. En cualquier otro campo son del cursor.
        if (inField && !inSearch) {
          return;
        }

        event.preventDefault();
        this.moveActive(event.key === 'ArrowDown' ? 1 : -1);
        return;

      case 'Delete':
        // Con algo escrito en el campo de carga, `Supr` borra un carácter: sacar una línea del
        // carrito mientras se está tipeando un código sería la peor sorpresa posible.
        if (inField && (!inSearch || (target as HTMLInputElement).value.length > 0)) {
          return;
        }

        event.preventDefault();
        this.onRemoveActiveLine();
        return;

      default:
        // Lo que teclee el lector tiene que caer en el campo de carga, esté donde esté el foco: un
        // clic perdido en la pantalla no puede hacer que la próxima lectura se pierda.
        //
        // La barra espaciadora queda afuera: es como se aprieta el botón que tenga el foco, y
        // llevarse el foco en el `keydown` cancelaría el clic que iba a llegar en el `keyup`.
        if (
          !inField &&
          event.key.length === 1 &&
          event.key !== ' ' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          search?.focus();
        }
    }
  }

  /**
   * Abre el cobro, que es el paso previo a registrar la venta.
   *
   * Lo que falta se contesta acá y no deshabilitando el botón: apretar y que no pase nada obliga a
   * adivinar. Cuando lo que traba es el stock, en cambio, el diálogo del faltante **es** la
   * respuesta —la sucursal bloquea y hay que ajustar el carrito—, así que se abre en vez del cobro:
   * el 400 de `STRICT_BLOCK` trae los faltantes redactados dentro del mensaje y no se puede armar
   * con eso el detalle que la pantalla ya tiene calculado.
   */
  protected onCharge(): void {
    if (this.submitting()) {
      return;
    }

    this.chargeAttempted.set(true);

    if (this.missingRequirements().length > 0) {
      return;
    }

    if (this.cart.hasBlockingShortage()) {
      this.openShortageDialog(this.cart.shortages());
      return;
    }

    this.openPaymentDialog();
  }

  /**
   * Los pagos de la venta. Salen del diálogo ya armados y entran al carrito recién ahí, sobre el
   * filo del commit: cancelar deja la venta como estaba.
   */
  private openPaymentDialog(): void {
    this.dialog
      .open<SalePaymentDialogComponent, SalePaymentDialogData, SalePaymentDialogResult>(
        SalePaymentDialogComponent,
        {
          width: '32rem',
          maxWidth: '95vw',
          data: {
            paymentMethods: this.paymentMethods(),
            promotionContext: this.cart.promotionContext(),
            payments: this.cart.payments(),
            customer: this.cart.customer(),
            receiver: this.cart.receiver(),
            availability: this.availability(),
          },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!result) {
          return;
        }

        this.cart.setPayments(result.payments);
        this.cart.setReceiver(result.receiver);
        this.commit(NO_OVERRIDES);
      });
  }

  /**
   * Manda la venta.
   *
   * Las excepciones viajan juntas y se acumulan porque una venta puede necesitar las dos: se
   * confirma el faltante de stock, el commit vuelve rechazado por límite, se autoriza el exceso, y
   * el reenvío tiene que seguir llevando la confirmación del stock. Reiniciarlas en cada vuelta
   * haría que el operador conteste la misma pregunta dos veces.
   */
  private commit(overrides: CommitOverrides): void {
    const payload = this.buildPayload(overrides);
    if (!payload) {
      return;
    }

    this.submitting.set(true);

    this.ordersApi
      .commit(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.submitting.set(false);
          this.onCommitted(order);
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.onCommitFailed(error, overrides);
        },
      });
  }

  private onCommitted(order: OrderDto): void {
    const total = order.orderCheckout?.totalAmount ?? this.cart.totals().totalAmount;

    this.toast.success(
      this.translate.instant('sales.toasts.saleCompleted', {
        // Hoy la sucursal numera todas las operaciones, fiscales incluidas; el fallback queda por si
        // el día de mañana el circuito fiscal se lleva la numeración y el número no vuelve.
        publicId: order.publicId ?? this.translate.instant('sales.toasts.pendingNumber'),
        total: this.formatAmount(total),
      }),
    );

    // El carrito se vacía y no se refresca stock: el buscador lo vuelve a leer de la API en cuanto
    // se escanee el próximo producto, que es lo que pasa a continuación en un mostrador.
    this.cart.clearCart();
    // La venta siguiente arranca sin el aviso de la anterior: nadie intentó cobrarla todavía.
    this.chargeAttempted.set(false);
    // Y arranca en el ahora: una fecha atrasada era de la venta que se acaba de registrar, y
    // heredarla en silencio imputaría la próxima a la sesión de caja equivocada.
    this.cart.setDateOperation(new Date());
    // La nota también: describe la venta que se acaba de cerrar, no al cliente ni al mostrador.
    this.cart.setObservations('');
    // Y el receptor: era el comprador de esta venta. Heredarlo facturaría la próxima a su nombre.
    this.cart.setReceiver(null);
    // El cliente sí se queda —en un mostrador la venta siguiente suele ser del mismo—, pero su
    // saldo se acaba de mover: el panel se vuelve a pedir para no seguir mostrando el disponible de
    // antes de esta venta.
    this.loadAvailability(this.cart.customer()?.uuid ?? null);
    this.productSearch()?.focus();
  }

  private onCommitFailed(error: unknown, overrides: CommitOverrides): void {
    const warning = readStockValidationWarning(error);

    // 409: la sucursal es WARNING_CONFIRMATION y el backend mandó el detalle exacto del faltante.
    if (warning?.shortages?.length) {
      this.openShortageDialog(warning.shortages, overrides);
      return;
    }

    // 400 por límite de cuenta corriente, con la marca de forzable que puso el backend. El diálogo
    // se abre **con o sin** el permiso de forzar: las dos salidas que ofrece —llevar lo que entra a
    // cuenta y cobrar el resto por otro medio— no dependen de ningún permiso, y un «no se puede» a
    // secas manda al cajero a llamar por teléfono sin saber cuánto entra ni qué pedir.
    const debtLimit = readAccountDebtLimit(error);
    if (debtLimit) {
      this.openAccountOverrideDialog(debtLimit, overrides);
      return;
    }

    // 400 BATCH_EXPIRED (RN-04): lo que hay del producto está vencido. Con WARN se confirma y se
    // reintenta el mismo commit; con BLOCK sólo se explica, porque no hay salida desde acá.
    const expired = readExpiredBatchError(error);
    if (expired) {
      this.handleExpiredBatch(expired, overrides);
      return;
    }

    this.toast.error(
      resolveApiErrorMessage(error, this.translate.instant('sales.toasts.commitError')),
    );
  }

  private handleExpiredBatch(
    expired: NonNullable<ReturnType<typeof readExpiredBatchError>>,
    overrides: CommitOverrides,
  ): void {
    const product = expired.productName ?? '';
    const batches = expired.batches.map((batch) => batch.batchNumber ?? '—').join(', ');

    if (!expired.confirmable) {
      this.toast.error(this.translate.instant('sales.expired.blocked', { product, batches }));
      return;
    }

    this.confirmDialog
      .confirm({
        title: this.translate.instant('sales.expired.title'),
        message: this.translate.instant('sales.expired.message', { product, batches }),
        confirmLabel: this.translate.instant('sales.expired.confirm'),
        cancelLabel: this.translate.instant('sales.expired.cancel'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.commit({ ...overrides, confirmExpired: true });
        }
      });
  }

  /** El selector de lote de una línea (§7.3). Devuelve por el carrito lo que el operador eligió. */
  protected onBatchPick(line: SaleCartLineView): void {
    if (!this.canSelectBatch) {
      return;
    }

    this.dialog
      .open<BatchPickerDialogComponent, BatchPickerDialogData, BatchPickerDialogResult>(
        BatchPickerDialogComponent,
        {
          width: '36rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data: { product: line.product, quantity: line.quantity, current: line.chosenBatch },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result !== undefined) {
          this.cart.setLineBatch(line.product.uuid, result);
        }

        // Elegido o no, lo que sigue es escanear: el foco vuelve solo al campo de carga.
        this.productSearch()?.focus();
      });
  }

  /**
   * Elegir qué unidades se lleva el cliente. A diferencia del lote, **no exige permiso**: no es
   * salirse de una política, es decir qué notebook sale (§9).
   */
  protected onSerialPick(line: SaleCartLineView): void {
    this.dialog
      .open<SerialPickerDialogComponent, SerialPickerDialogData, SerialPickerDialogResult>(
        SerialPickerDialogComponent,
        {
          width: '32rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data: {
            product: line.product,
            quantity: line.quantity,
            current: line.serials,
            lead: this.translate.instant('stock.serialPicker.leadSale'),
          },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result !== undefined) {
          this.cart.setLineSerials(line.product.uuid, result);
        }

        this.productSearch()?.focus();
      });
  }

  protected onSerialRemove(change: CartSerialRemove): void {
    const line = this.cart.lineViews().find((row) => row.product.uuid === change.productUuid);
    if (line) {
      this.cart.setLineSerials(
        change.productUuid,
        line.serials.filter((serial) => serial !== change.serial),
      );
    }
  }

  protected onBatchReset(productUuid: string): void {
    this.cart.setLineBatch(productUuid, null);
  }

  private openShortageDialog(
    shortages: readonly StockShortageDetail[],
    overrides: CommitOverrides = NO_OVERRIDES,
  ): void {
    this.dialog
      .open<StockShortageDialogComponent, StockShortageDialogData, StockShortageDialogResult>(
        StockShortageDialogComponent,
        {
          width: '34rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data: { shortages, policy: this.cart.stockValidationPolicy() },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (result === 'confirm') {
          this.commit({ ...overrides, confirmStock: true });
        }
      });
  }

  /**
   * La excepción autorizada: se pide el motivo y se reenvía la misma venta.
   *
   * El motivo es obligatorio y no lo valida esta pantalla por cortesía —el backend responde 400 sin
   * él aunque el permiso esté—: queda estampado en la deuda junto con quién autorizó y cuánto se
   * pasó del límite, y es lo que se lee cuando alguien pregunta, meses después, cómo este cliente
   * llegó hasta acá.
   */
  private openAccountOverrideDialog(
    detail: ReturnType<typeof readAccountDebtLimit>,
    overrides: CommitOverrides,
  ): void {
    if (!detail) {
      return;
    }

    this.dialog
      .open<AccountOverrideDialogComponent, AccountOverrideDialogData, AccountOverrideDialogResult>(
        AccountOverrideDialogComponent,
        {
          width: '32rem',
          maxWidth: '95vw',
          data: {
            partyName: this.cart.customer()?.name ?? '',
            detail,
            canOverride: this.canOverrideAccountLimit,
          },
        },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((reason) => {
        if (reason) {
          this.commit({ ...overrides, accountReason: reason });
        }
      });
  }

  private buildPayload(overrides: CommitOverrides): OrderCommitPayload | null {
    const customer = this.cart.customer();
    const voucher = this.cart.voucher();
    const cashRegisterUuid = this.cashRegisterUuid();

    if (!voucher || !cashRegisterUuid) {
      return null;
    }

    const observations = this.cart.observations().trim();
    const receiver = this.cart.receiver();

    return {
      voucher: { uuid: voucher.uuid },
      // La venta sin tercero es la de mostrador: no viaja contraparte y el backend valoriza con la
      // lista principal de la empresa.
      ...(customer ? { partyRole: { uuid: customer.uuid } } : {}),
      cashRegister: { uuid: cashRegisterUuid },
      // `LocalDateTime` sin zona: es el reloj de la sucursal, y con él el backend resuelve contra
      // qué sesión de caja se imputa la venta.
      dateOperation: toLocalDateTime(this.cart.dateOperation()),
      // La nota en blanco no viaja: el backend la guardaría como `null` de todos modos.
      ...(observations ? { observations } : {}),
      // El receptor viaja sólo si alguien lo tocó. Sin bloque, el backend copia los cuatro campos
      // de la ficha del cliente —o los deja nulos y el comprobante sale a consumidor final—, que es
      // exactamente lo que esta pantalla mostró. Con bloque, manda el bloque **entero**: el backend
      // no lo mezcla campo a campo con la ficha, y por eso el diálogo lo abre precargado.
      ...(receiver ?? {}),
      items: this.cart.lines().map((line) => ({
        product: { uuid: line.product.uuid },
        quantity: line.quantity,
        // La lista viaja congelada como snapshot: si el precio de la línea salió de la principal
        // por fallback, es esa la que se guarda y no la preferida del cliente, que no lo tenía.
        ...(line.priceListUuid ? { priceList: { uuid: line.priceListUuid } } : {}),
        // El lote elegido a mano viaja sólo si el operador lo eligió: sin él, la política de la
        // sucursal decide en el backend, y el lote asignado vuelve en `stockItems`.
        ...(isBatchTracked(line.product) && line.chosenBatch
          ? { batches: [{ batchUuid: line.chosenBatch.uuid, quantity: line.quantity }] }
          : {}),
        // Las unidades elegidas. Con series el reparto por lote lo deriva el backend de cada
        // unidad, así que no hay nada más que mandar (RN-17).
        ...(isSerialTracked(line.product) ? { serials: [...line.serials] } : {}),
      })),
      orderCheckout: {
        payments: this.cart.payments().map((payment) => ({
          paymentMethod: { uuid: payment.paymentMethod.uuid },
          amount: payment.amount,
        })),
      },
      ...(overrides.confirmStock ? { confirmStockOverride: true } : {}),
      ...(overrides.confirmExpired ? { confirmExpiredOverride: true } : {}),
      // Los dos van juntos: el backend rechaza la confirmación sin motivo, y con razón — es
      // justamente el motivo lo que hace que la excepción sirva de algo.
      ...(overrides.accountReason
        ? { confirmAccountOverride: true, accountOverrideReason: overrides.accountReason }
        : {}),
    };
  }

  /**
   * Qué caja usar, en orden de autoridad: la que resolvió el backend por preasignación, la que el
   * usuario eligió antes en esta sucursal, la única que hay abierta, o nada.
   */
  /**
   * Fija la caja de la pantalla y la deja registrada.
   *
   * Se recuerda también la que se resolvió sola —la preasignada, o la única abierta— y no sólo la
   * que el operador elige del menú: de ahí sale el header `X-Cash-Register-Uuid`, y sin él el
   * commit se rechaza con un 400 aunque el cuerpo traiga la caja.
   */
  private useCashRegister(uuid: string | null): void {
    this.cashRegisterUuid.set(uuid);

    if (uuid) {
      this.selectedCashRegister.write(this.auth.selectedBranchUuid(), uuid);
    }
  }

  private resolveCashRegisterUuid(
    cashRegisters: readonly CashRegisterDto[],
    preassignedUuid: string | null,
  ): string | null {
    const exists = (uuid: string | null) =>
      uuid !== null && cashRegisters.some((register) => register.uuid === uuid);

    if (exists(preassignedUuid)) {
      return preassignedUuid;
    }

    const remembered = this.selectedCashRegister.read(this.auth.selectedBranchUuid());
    if (exists(remembered)) {
      return remembered;
    }

    const open = cashRegisters.filter(hasOpenSession);
    return open.length === 1 ? open[0].uuid : null;
  }

  /** El toast lleva el total dentro del mensaje, así que se formatea acá y no con el componente. */
  private formatAmount(value: number): string {
    return new Intl.NumberFormat(this.language.localeId(), {
      style: 'currency',
      currency: 'ARS',
    }).format(value);
  }
}

/**
 * Con qué comprobante arranca la pantalla. El catálogo que llega ya son todos de venta, así que lo
 * que queda por elegir es cuál: se prefiere el primero que además **cobra** —descarga stock y
 * acredita balance—, que es lo que se emite en un mostrador. Ordenado por nombre, el primero podría
 * ser un presupuesto o una nota de crédito, que no mueven ni stock ni caja.
 */
function pickDefaultVoucher(vouchers: readonly SaleVoucherDto[]): SaleVoucherDto | null {
  const invoice = vouchers.find(
    (voucher) => voucher.stockEffect === 'DECREMENT' && voucher.balanceEffect === 'INCREMENT',
  );

  return invoice ?? vouchers[0] ?? null;
}
