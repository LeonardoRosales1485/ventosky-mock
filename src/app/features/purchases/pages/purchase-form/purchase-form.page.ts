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
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  CASH_REGISTER_OPEN_PERMISSION,
  CashRegisterDto,
  branchCashRegisters,
  hasOpenSession,
  withOpenSession,
} from '../../../../core/cash-session/cash-session.model';
import { CashSessionService } from '../../../../core/cash-session/cash-session.service';
import { SelectedCashRegisterStore } from '../../../../core/cash-session/selected-cash-register.store';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  fromLocalDateTime,
  isSameLocalDay,
  toLocalDateTime,
} from '../../../../core/orders/local-date-time';
import {
  OrderCommitItem,
  OrderCommitPayload,
  OrderCommitPayment,
  OrderConvertPayload,
  OrderDto,
} from '../../../../core/orders/order-commit.model';
import { AccountAvailabilityDto } from '../../../../core/checking-accounts/account-availability.model';
import { AccountAvailabilityService } from '../../../../core/checking-accounts/account-availability.service';
import { AccountPanelComponent } from '../../../../core/checking-accounts/account-panel/account-panel.component';
import { OrdersApiService } from '../../../../core/orders/orders-api.service';
import { PurchaseModelLoadComponent } from '../../components/purchase-model-load/purchase-model-load.component';
import { ModelLoadLine } from '../../components/purchase-model-load/model-load-grid';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  PurchaseCartComponent,
  PurchasePackagingChange,
  PurchaseQuantityChange,
  PurchaseUnitCostChange,
  PurchaseBatchesChange,
  PurchaseSerialsChange,
} from '../../components/purchase-cart/purchase-cart.component';
import { PurchaseCashSessionChipComponent } from '../../components/purchase-cash-session-chip/purchase-cash-session-chip.component';
import { PurchaseDetailsComponent } from '../../components/purchase-details/purchase-details.component';
import {
  NewPurchasePayment,
  PurchasePaymentsComponent,
} from '../../components/purchase-payments/purchase-payments.component';
import {
  PurchaseProductScanned,
  PurchaseProductSearchComponent,
} from '../../components/purchase-product-search/purchase-product-search.component';
import { PurchaseTotalsComponent } from '../../components/purchase-totals/purchase-totals.component';
import {
  DEFAULT_TAX_RATE,
  BLOCKING_PURCHASE_CATALOGS,
  PURCHASE_CREATE_PERMISSION,
  PurchaseCatalogName,
  PURCHASE_EDIT_PERMISSION,
  PurchasePaymentMethodDto,
  PurchaseProductDto,
  PurchaseSupplierDto,
  PurchaseVoucherDto,
  isDraftOrderVoucher,
  isEditablePurchase,
  isBatchTracked,
  isSerialTracked,
} from '../../data-access/purchase.model';
import { PurchasesCatalogApiService } from '../../data-access/purchases-catalog-api.service';
import { NEW_PURCHASE_PATH, PURCHASES_PATH } from '../../purchases.paths';
import { PurchaseCart } from '../../state/purchase-cart';

/**
 * La compra: se elige el proveedor, el comprobante y la fecha, se cargan las líneas con su costo, se
 * declara cómo se paga y se cierra.
 *
 * Es **una sola pantalla para el alta y para la edición**, igual que el formulario de producto: la
 * diferencia es el `uuid` que trae la ruta.
 *
 * - **Alta** (`/panel/new-purchase`): la operación vive en memoria hasta el final y
 *   `POST /order/commit` la persiste entera —orden, líneas, comprobante, pagos y movimientos de
 *   stock— o no persiste nada, así que un error deja lo cargado intacto y se puede reintentar tal
 *   cual está.
 * - **Edición** (`/panel/purchases/{uuid}/edit`): `POST /order/{uuid}/convert`, la única escritura
 *   que el backend acepta sobre una orden existente. Sólo alcanza a la **orden de compra borrador**
 *   —la cerrada contra un comprobante sin efectos—: reemplaza comprobante, líneas y checkout, y
 *   aplica recién ahí el stock, el costo y el saldo que el commit original no aplicó. Una compra ya
 *   aplicada no se edita por ningún camino; de eso se ocupa {@link isEditablePurchase}, que decide
 *   también qué filas del listado ofrecen el botón.
 *
 * Convertir no es "guardar de nuevo": lo que llega **pisa** la orden. Por eso la edición reenvía
 * también lo que no cambió —el proveedor, el vencimiento— en vez de omitirlo por redundante.
 *
 * Los importes que muestra son una anticipación de los que calculará el backend (ver
 * `core/pricing/order-pricing.ts`); los definitivos son los que devuelve la API.
 *
 * A diferencia del mostrador, **no** entra en modo inmersivo: cargar compras es trabajo de
 * back-office y se hace con el panel a mano, no con la pantalla tomada.
 */
@Component({
  selector: 'app-purchase-form-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    AccountPanelComponent,
    LoadStateComponent,
    PageHeaderComponent,
    PurchaseCartComponent,
    PurchaseCashSessionChipComponent,
    PurchaseDetailsComponent,
    PurchasePaymentsComponent,
    PurchaseProductSearchComponent,
    PurchaseTotalsComponent,
  ],
  providers: [OrdersApiService, PurchasesCatalogApiService, AccountAvailabilityService],
  templateUrl: './purchase-form.page.html',
  styleUrl: './purchase-form.page.css',
})
export class PurchaseFormPage implements OnInit {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly catalogApi = inject(PurchasesCatalogApiService);
  private readonly selectedCashRegister = inject(SelectedCashRegisterStore);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly toast = inject(ToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cashSession = inject(CashSessionService);
  private readonly accountAvailability = inject(AccountAvailabilityService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);

  private readonly productSearch = viewChild(PurchaseProductSearchComponent);

  protected readonly cart = new PurchaseCart();

  /** La orden que se está editando; `null` en el alta. Es lo que parte a la pantalla en dos. */
  protected readonly orderUuid = this.route.snapshot.paramMap.get('uuid');
  protected readonly isEdit = this.orderUuid !== null;

  /**
   * `version` de la orden abierta, para el bloqueo optimista del convert. Se guarda suelta —y no la
   * orden entera— porque es lo único que la pantalla no puede reconstruir de lo que muestra.
   */
  private readonly orderVersion = signal<number | null>(null);

  /** El vencimiento que traía la orden. Se reenvía tal cual: convertir sin él lo borraría. */
  private orderExpiresAt: string | null = null;

  /** Número de la orden, para el breadcrumb y el toast. */
  protected readonly orderPublicId = signal<string | null>(null);

  protected readonly canBuy = this.auth.hasPermission(
    this.isEdit ? PURCHASE_EDIT_PERMISSION : PURCHASE_CREATE_PERMISSION,
  );

  protected readonly catalogsState = signal(LoadState.Loading);
  /**
   * Los catálogos que no cargaron. Cada uno cae a su vacío para no tumbar la pantalla, pero se dice cuál
   * fue: un 403 en los comprobantes dejaba la compra bloqueada en «elegí el comprobante» sin ninguno.
   */
  protected readonly failedCatalogs = signal<readonly PurchaseCatalogName[]>([]);
  protected readonly submitting = signal(false);

  /**
   * El estado de la cuenta corriente del proveedor.
   *
   * **En una compra no se muestra ni disponible ni límite** —el backend los manda en nulo y el panel
   * los omite— porque no hay nada que consumir: cuánto nos fía un proveedor lo decide el proveedor, y
   * mostrar un tope que no se valida es una invitación a que alguien lo implemente. Lo que sí importa
   * acá es el saldo, lo vencido y si la cuenta está deshabilitada.
   */
  protected readonly availability = signal<AccountAvailabilityDto | null>(null);

  /**
   * El titular no tiene cuenta corriente: un 404, que no es un error. El panel lo dice en vez de
   * quedarse en blanco — «no puede llevar nada» y «no hay a quién preguntarle» no son lo mismo.
   */
  protected readonly noAccount = signal(false);
  protected readonly availabilityLoading = signal(false);

  /**
   * Por qué no se pudo abrir la orden, cuando el motivo es del negocio y no de la red: no existe, no
   * es editable, o es de otra sucursal. Reintentar no arregla ninguno de los tres, así que el estado
   * de error los dice con su texto y sin botón.
   */
  protected readonly loadErrorKey = signal<string | null>(null);

  protected readonly retryable = computed(() => this.loadErrorKey() === null);

  protected readonly loadErrorMessageKey = computed(
    () => this.loadErrorKey() ?? 'purchases.newPurchase.loadError',
  );

  protected readonly titleKey = this.isEdit
    ? 'purchases.editPurchase.title'
    : 'purchases.newPurchase.title';

  protected readonly descriptionKey = this.isEdit
    ? 'purchases.editPurchase.description'
    : 'purchases.newPurchase.description';

  protected readonly suppliers = signal<readonly PurchaseSupplierDto[]>([]);
  protected readonly vouchers = signal<readonly PurchaseVoucherDto[]>([]);
  protected readonly paymentMethods = signal<readonly PurchasePaymentMethodDto[]>([]);
  protected readonly cashRegisters = signal<readonly CashRegisterDto[]>([]);
  protected readonly cashRegisterUuid = signal<string | null>(null);

  /** `cash_register.open`: sin él el chip informa la caja cerrada pero no ofrece abrirla. */
  protected readonly canOpenCashSession = this.auth.hasPermission(CASH_REGISTER_OPEN_PERMISSION);
  protected readonly openingCashSession = signal(false);

  /** Productos cuya regla de precio ya se pidió, se haya resuelto o no: no se vuelve a preguntar. */
  private readonly roundingRequested = new Set<string>();

  /** Ídem para el costo actual, que se propone una sola vez por producto y por sesión de pantalla. */
  private readonly costRequested = new Set<string>();

  protected readonly cashRegister = computed(
    () => this.cashRegisters().find((item) => item.uuid === this.cashRegisterUuid()) ?? null,
  );

  /**
   * Si la fecha de la operación cae hoy.
   *
   * Es lo que decide qué puede anticipar la pantalla: el backend acepta una sesión **abierta del
   * mismo día calendario** o una **cerrada cuyo intervalo contenga** el instante. De las abiertas se
   * entera el front —vienen en el listado de cajas—; de las cerradas no, así que para una fecha
   * pasada no hay nada que verificar de este lado.
   */
  protected readonly isToday = computed(() =>
    isSameLocalDay(this.cart.dateOperation(), new Date()),
  );

  /**
   * Si la caja alcanza para intentar el commit.
   *
   * Con fecha de hoy se exige sesión abierta, igual que el mostrador. Con fecha anterior alcanza con
   * tener una caja elegida: puede haber una sesión cerrada que cubra ese instante y el front no
   * tiene cómo saberlo, así que se manda y, si ninguna aplica, se muestra el 400 del backend. Cortar
   * acá impediría justamente lo que la fecha editable viene a habilitar — cargar una compra
   * olvidada contra la caja del día que corresponde.
   */
  protected readonly cashSessionReady = computed(() =>
    this.isToday() ? hasOpenSession(this.cashRegister()) : this.cashRegister() !== null,
  );

  protected readonly canConfirm = computed(
    () => this.canBuy && this.cashSessionReady() && this.cart.isReadyToCommit(),
  );

  /**
   * Con un comprobante sin efectos no se está registrando una compra hecha sino emitiendo un pedido
   * al proveedor: el botón que cierra —y el aviso que confirma— lo dicen con esas palabras.
   */
  protected readonly isDraftOrder = computed(() => isDraftOrderVoucher(this.cart.voucher()));

  protected readonly confirmLabelKey = computed(() => {
    if (!this.isEdit) {
      return this.isDraftOrder() ? 'purchases.actions.issueOrder' : 'purchases.totals.confirm';
    }

    /*
     * Editando, lo que se está haciendo lo decide el comprobante que quedó elegido: con uno sin
     * efectos la orden sigue siendo un pedido y esto es corregirlo; con uno que ingresa mercadería,
     * la orden deja de existir como tal y pasa a ser la compra.
     */
    return this.isDraftOrder() ? 'purchases.actions.saveOrder' : 'purchases.actions.convertOrder';
  });

  /**
   * Si hay algo que descartar. El proveedor y el comprobante no cuentan: sobreviven a propósito
   * entre una compra y la siguiente, así que con la pantalla recién abierta no hay nada que
   * cancelar aunque vengan elegidos por defecto.
   *
   * Editando siempre hay salida: ahí el botón no vacía el carrito, vuelve al listado.
   */
  protected readonly canDiscard = computed(
    () =>
      this.isEdit ||
      !this.cart.isEmpty() ||
      this.cart.payments().length > 0 ||
      this.cart.observations().length > 0,
  );

  /**
   * Por qué no se puede confirmar todavía, en el orden en que conviene resolverlo: primero lo que
   * bloquea toda la pantalla (permiso, caja), después lo que le falta a esta compra.
   */
  protected readonly blockedReasonKey = computed<string | null>(() => {
    if (!this.canBuy) {
      return this.isEdit ? 'purchases.blocked.editPermission' : 'purchases.blocked.permission';
    }

    if (this.failedCatalogs().some((name) => BLOCKING_PURCHASE_CATALOGS.includes(name))) {
      return 'purchases.blocked.catalogs';
    }

    if (this.cashRegister() === null) {
      return 'purchases.blocked.cashRegister';
    }

    if (!this.cashSessionReady()) {
      return 'purchases.blocked.cashSession';
    }

    if (this.cart.isEmpty()) {
      return 'purchases.blocked.emptyCart';
    }

    if (this.cart.linesWithoutCost().length > 0) {
      return 'purchases.blocked.cost';
    }

    // Cada línea con partidas tiene que estar repartida antes de confirmar (§7.2).
    if (this.cart.linesWithBatchIssues().length > 0) {
      return 'purchases.blocked.batches';
    }

    // Y cada línea serializada tiene que tener sus números cargados (RN-17).
    if (this.cart.linesWithSerialIssues().length > 0) {
      return 'purchases.blocked.serials';
    }

    if (this.cart.supplier() === null) {
      return 'purchases.blocked.supplier';
    }

    if (this.cart.voucher() === null) {
      return 'purchases.blocked.voucher';
    }

    // Sólo cuando el comprobante registra pago: una orden de compra no tiene nada que cubrir.
    if (
      this.cart.requiresPayment() &&
      (!this.cart.isFullyPaid() || this.cart.payments().length === 0)
    ) {
      return 'purchases.blocked.payment';
    }

    return null;
  });

  protected readonly LoadState = LoadState;

  constructor() {
    // Editando, la última miga es la orden: muestra el título genérico mientras el detalle está en
    // vuelo y su número apenas llega.
    this.breadcrumb.publish(() => {
      if (!this.isEdit) {
        return [BREADCRUMB_HOME, { labelKey: 'nav.items.newPurchase', link: NEW_PURCHASE_PATH }];
      }

      const publicId = this.orderPublicId();

      return [
        BREADCRUMB_HOME,
        { labelKey: 'nav.items.purchases', link: PURCHASES_PATH },
        publicId ? { label: publicId } : { labelKey: 'purchases.editPurchase.title' },
      ];
    });

    // El panel del proveedor, apenas se lo elige. En una compra no frena nada —el límite no se
    // valida— pero saber que le debemos $400.000 vencidos antes de cargar la factura es
    // exactamente el momento en que ese dato sirve para algo.
    effect(() => this.loadAvailability(this.cart.supplier()?.uuid ?? null));
  }

  /**
   * Trae el estado de la cuenta del proveedor. Se pregunta como `PURCHASE`, y por eso la respuesta
   * viene sin límite ni disponible: los dos son nulos del lado del backend, no algo que la pantalla
   * decida esconder.
   *
   * Un proveedor sin cuenta responde 404, y eso no es un error que valga un cartel: el panel queda
   * vacío, que es la forma honesta de no afirmar nada sobre una cuenta que no existe.
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
      .forPartyRole(partyRoleUuid, 'PURCHASE')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (availability) => {
          this.availabilityLoading.set(false);
          // Pudo cambiar de proveedor mientras la respuesta viajaba: la de otro pintaría un saldo
          // que no es el de esta compra.
          if (this.cart.supplier()?.uuid === partyRoleUuid) {
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

  protected loadCatalogs(): void {
    this.catalogsState.set(LoadState.Loading);
    this.loadErrorKey.set(null);

    // Cada catálogo cae a su vacío en vez de tumbar la pantalla: un usuario sin `supplier.view` no
    // puede elegir proveedor, pero eso se dice en su lugar y no como un error de carga.
    //
    // La orden es la excepción: editando no hay nada que mostrar sin ella, y abrir un formulario en
    // blanco pisaría la orden al convertir.
    //
    // No se piden ni listas de precios ni la configuración de stock: en compra el backend fuerza la
    // lista a `NULL`, y la política de stock sólo se evalúa cuando el comprobante descuenta.
    const failed: PurchaseCatalogName[] = [];
    const fallen = (name: PurchaseCatalogName) => {
      failed.push(name);
      return of([]);
    };
    forkJoin({
      suppliers: this.catalogApi.getSuppliers().pipe(catchError(() => fallen('suppliers'))),
      vouchers: this.catalogApi.getVouchers().pipe(catchError(() => fallen('vouchers'))),
      paymentMethods: this.catalogApi
        .getPaymentMethods()
        .pipe(catchError(() => fallen('paymentMethods'))),
      cashRegisters: this.catalogApi
        .getCashRegisters()
        .pipe(catchError(() => fallen('cashRegisters'))),
      entryContext: this.catalogApi.getCashRegisterEntryContext().pipe(catchError(() => of(null))),
      order: this.orderUuid ? this.ordersApi.getByUuid(this.orderUuid) : of(null),
    })
      .pipe(
        switchMap((catalogs) => this.withOrderProducts(catalogs)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (loaded) => {
          this.failedCatalogs.set(failed);
          this.suppliers.set(loaded.suppliers);
          this.vouchers.set(loaded.vouchers);
          this.paymentMethods.set(loaded.paymentMethods);
          const cashRegisters = branchCashRegisters(
            loaded.cashRegisters,
            this.auth.selectedBranchUuid(),
          );
          this.cashRegisters.set(cashRegisters);

          const order = loaded.order;
          if (order) {
            const blockedKey = this.uneditableReasonKey(order);
            if (blockedKey) {
              this.loadErrorKey.set(blockedKey);
              this.catalogsState.set(LoadState.Error);
              return;
            }

            this.applyOrder(order, loaded.products);
          } else {
            this.cart.setVoucher(pickDefaultVoucher(loaded.vouchers));
          }

          this.useCashRegister(
            this.resolveCashRegisterUuid(
              cashRegisters,
              // Editando manda la caja de la orden: es la que tiene la sesión que cubre su fecha, y
              // el backend cae a ella si el convert no nombra ninguna.
              order?.cashRegister?.uuid ?? loaded.entryContext?.cashRegister?.uuid ?? null,
            ),
          );

          this.catalogsState.set(LoadState.Success);
          this.focusSearch();
        },
        error: () => this.catalogsState.set(LoadState.Error),
      });
  }

  /**
   * Le agrega a los catálogos los productos de las líneas de la orden, que sólo se pueden pedir una
   * vez que la orden llegó. Que fallen no impide editar: la línea sabe su nombre, su cantidad y su
   * costo, y con eso alcanza — lo que se pierde es la precisión de la cantidad y el stock al costado.
   */
  private withOrderProducts<T extends { order: OrderDto | null }>(
    catalogs: T,
  ): Observable<T & { products: readonly PurchaseProductDto[] }> {
    const productUuids = (catalogs.order?.items ?? [])
      .map((item) => item.product?.uuid)
      .filter((uuid): uuid is string => !!uuid);

    if (productUuids.length === 0) {
      return of({ ...catalogs, products: [] });
    }

    return this.catalogApi.getProductsByUuid(productUuids).pipe(
      catchError(() => of([] as PurchaseProductDto[])),
      map((products) => ({ ...catalogs, products })),
    );
  }

  /**
   * Por qué esta orden no se puede editar acá, o `null` si sí.
   *
   * Repite del lado del front la guarda de `OrderConversionService.assertConvertible` —el listado ya
   * apaga el botón, pero a esta ruta también se llega escribiéndola o con un link viejo— y agrega
   * una propia: la sucursal. El convert **no** deja cambiarla y aplica el stock en la de la orden,
   * mientras que la caja saldría de la sucursal activa; editar desde otra repartiría la operación
   * entre dos, así que se pide cambiar de sucursal en vez de dejar hacerlo.
   */
  private uneditableReasonKey(order: OrderDto): string | null {
    if (!isEditablePurchase(order)) {
      return 'purchases.editPurchase.notEditable';
    }

    const branchUuid = this.auth.selectedBranchUuid();
    if (branchUuid && order.branch?.uuid && order.branch.uuid !== branchUuid) {
      return 'purchases.editPurchase.otherBranch';
    }

    return null;
  }

  /**
   * Vuelca la orden leída en el carrito. Corre con los catálogos ya cargados: los usa para resolver.
   *
   * Empieza vaciando porque puede correr más de una vez sobre la misma pantalla —`loadCatalogs()`
   * se repite cuando la caja resulta estar abierta por otro—, y volcar encima duplicaría las
   * cantidades de cada línea en vez de reponerlas.
   */
  private applyOrder(order: OrderDto, products: readonly PurchaseProductDto[]): void {
    this.cart.clearCart();

    this.orderVersion.set(order.version ?? 0);
    this.orderExpiresAt = order.expiresAt ?? null;
    this.orderPublicId.set(order.publicId ?? null);

    /*
     * El proveedor de la orden manda aunque no esté en el catálogo —dado de baja, o el usuario sin
     * `supplier.view` para listarlo—: no se puede cambiar, y sin él no se arma la conversión.
     */
    const supplierRef = order.partyRole;
    this.cart.setSupplier(
      this.suppliers().find((supplier) => supplier.uuid === supplierRef?.uuid) ??
        (supplierRef?.uuid ? { uuid: supplierRef.uuid, name: supplierRef.name ?? '' } : null),
    );

    // Arranca con el comprobante que ya tiene: editar una orden no obliga a convertirla.
    this.cart.setVoucher(
      this.vouchers().find((voucher) => voucher.uuid === order.voucher?.uuid) ?? null,
    );

    const dateOperation = fromLocalDateTime(order.dateOperation);
    if (dateOperation) {
      this.cart.setDateOperation(dateOperation);
    }

    this.cart.setObservations(order.observations ?? '');

    const catalogued = new Map(products.map((product) => [product.uuid, product]));

    for (const item of order.items ?? []) {
      const productUuid = item.product?.uuid;
      if (!productUuid) {
        continue;
      }

      /*
       * Del catálogo sale lo que la línea no guarda: la precisión de la cantidad y la alícuota
       * vigente, que es la que el convert va a volver a calcular. Sin él se usa lo que congeló la
       * línea, que alcanza para editarla.
       */
      const product = catalogued.get(productUuid) ?? {
        uuid: productUuid,
        name: item.product?.name ?? '',
        taxRate: item.taxRate ?? DEFAULT_TAX_RATE,
      };

      this.cart.addProduct(product, item.quantity ?? 1, item.unitPrice ?? null);
      this.loadProductRounding(productUuid);
    }
  }

  /**
   * Deja el cursor en el buscador, que es donde empieza el trabajo.
   *
   * Va después del render y no en el acto: mientras carga, `app-load-state` no proyecta el
   * contenido, así que el campo existe pero está fuera del documento —y enfocar algo desconectado no
   * hace nada—.
   */
  private focusSearch(): void {
    afterNextRender(() => this.productSearch()?.focus(), { injector: this.injector });
  }

  /**
   * Entra mercadería al carrito. La `quantity` viene resuelta por quien leyó el código: `1` en una
   * elección de la lista, las 1000 unidades del bulto al escanearlo, el peso de una etiqueta de
   * balanza. El carrito guarda siempre unidad base (RN-16), así que acá no hay nada que convertir.
   */
  protected onProductSelected({
    product,
    quantity,
    packaging,
    quantityFromCode,
  }: PurchaseProductScanned): void {
    this.cart.addProduct(product, quantity, null, packaging, quantityFromCode);
    this.loadProductRounding(product.uuid);
    this.loadProductCost(product.uuid);
  }

  /**
   * «Carga por modelo»: elegir el modelo y reponerlo entero en una pasada (§5.6, wireframe `1p`).
   *
   * El modelo se elige **dentro del diálogo**, en un desplegable, y no en el selector de productos:
   * el remito del proveedor dice «Remera Básica», y obligar a buscar una de sus doce variantes para
   * llegar al modelo era un rodeo que además fallaba con cualquier producto suelto.
   *
   * Va con el `Injector` de la pantalla porque el diálogo lee los modelos de
   * `PurchasesCatalogApiService`, que se provee acá y no en la raíz: sin él, `NG0201`.
   */
  protected onModelLoad(): void {
    this.dialog
      .open<PurchaseModelLoadComponent, void, ModelLoadLine[]>(PurchaseModelLoadComponent, {
        width: '48rem',
        maxWidth: '95vw',
        maxHeight: '90vh',
        autoFocus: 'first-tabbable',
        injector: this.injector,
      })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lines) => this.addModelLines(lines ?? []));
  }

  /**
   * Cada celda se convierte en una línea normal de la grilla: desde acá sigue el flujo de siempre
   * —costo, lote, empaque—. No hay una línea «de modelo» en la compra.
   *
   * La cantidad de la celda es **explícita** —seis remeras son seis remeras— y se marca como tal:
   * si el detalle del producto trae después un bulto por defecto, la línea estrena el selector pero
   * no reinterpreta un `1` como un bulto entero.
   */
  private addModelLines(lines: readonly ModelLoadLine[]): void {
    for (const line of lines) {
      this.cart.addProduct(line.product, line.quantity, null, null, true);
      this.loadProductRounding(line.product.uuid);
      this.loadProductCost(line.product.uuid);
    }

    if (lines.length > 0) {
      this.toast.success(
        this.translate.instant('purchases.modelLoad.added', { count: lines.length }),
      );
    }

    // Se cerró —con líneas o sin ellas— y lo que sigue es cargar el próximo renglón del remito.
    this.productSearch()?.focus();
  }

  /** El empaque con el que se carga una línea, elegido en su fila. */
  protected onLinePackagingChange({ productUuid, packaging }: PurchasePackagingChange): void {
    this.cart.setLinePackaging(productUuid, packaging);
  }

  /**
   * Con qué criterio redondear los importes de este producto. Desde `v74` lo declara la regla de
   * precio que lo alcanza, no la sucursal, así que hay que resolverlo **por producto**: con el
   * criterio equivocado el total que muestra la pantalla no es el que va a persistir el commit.
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

  /**
   * Propone el costo actual del producto en la sucursal como punto de partida de la línea.
   *
   * Es una propuesta y no un dato: la compra es justamente donde el costo cambia, y quien carga el
   * comprobante lo corrige. Llega después de agregar el producto —es otra request— y por eso el
   * carrito lo aplica sólo si nadie escribió nada mientras tanto.
   *
   * Se pide una sola vez por producto y por sesión de pantalla: el costo no cambia entre dos líneas
   * de la misma compra, y quien lo cambia es esta misma operación al cerrarse.
   */
  private loadProductCost(productUuid: string): void {
    if (this.costRequested.has(productUuid)) {
      return;
    }
    this.costRequested.add(productUuid);

    this.catalogApi
      .getProductDetail(productUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((detail) => {
        const cost = detail?.cost ?? null;
        if (cost !== null && cost > 0) {
          this.cart.suggestUnitCost(productUuid, cost);
        }

        // Los empaques viven en el detalle, no en el paginado: una línea que entró por el buscador
        // de texto los recibe recién acá. Sin esto, el flujo natural de una compra —tipear lo que
        // dice el remito— se quedaba sin selector y sin el bulto por defecto, que es justo para lo
        // que existe la entrega.
        this.cart.setProductPackagings(productUuid, detail?.packagings ?? []);
      });
  }

  protected onQuantityChange(change: PurchaseQuantityChange): void {
    this.cart.setQuantity(change.productUuid, change.quantity);
  }

  protected onBatchesChange(change: PurchaseBatchesChange): void {
    this.cart.setBatches(change.productUuid, change.batches);
  }

  protected onSerialsChange(change: PurchaseSerialsChange): void {
    this.cart.setSerials(change.productUuid, change.serials);
  }

  protected onUnitCostChange(change: PurchaseUnitCostChange): void {
    this.cart.setUnitCost(change.productUuid, change.unitCost);
  }

  protected onRemoveLine(productUuid: string): void {
    this.cart.removeLine(productUuid);
  }

  /**
   * Descarta lo cargado y deja la pantalla lista para empezar de nuevo. El proveedor, el comprobante
   * y la fecha quedan: no son parte de "esta" compra sino del rato de trabajo.
   *
   * Editando no hay nada que dejar listo —la orden ya existe—, así que el mismo botón es la salida.
   */
  protected onDiscard(): void {
    if (this.isEdit) {
      this.goToList();
      return;
    }

    this.cart.clearCart();
    this.productSearch()?.focus();
  }

  /** El «volver» del encabezado, que sólo existe en la edición. */
  protected onBack(): void {
    this.goToList();
  }

  private goToList(): void {
    void this.router.navigate([PURCHASES_PATH]);
  }

  protected onSupplierChange(uuid: string): void {
    this.cart.setSupplier(this.suppliers().find((supplier) => supplier.uuid === uuid) ?? null);
  }

  protected onVoucherChange(uuid: string): void {
    this.cart.setVoucher(this.vouchers().find((voucher) => voucher.uuid === uuid) ?? null);
  }

  /**
   * Lo que escribió el campo `datetime-local`, que habla en hora local y sin zona — exactamente el
   * `LocalDateTime` que espera el backend. Un valor incompleto se ignora en vez de dejar la fecha en
   * `Invalid Date`: el campo pasa por estados a medio escribir mientras se tipea.
   */
  protected onDateOperationChange(value: string): void {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    this.cart.setDateOperation(parsed);
  }

  protected onObservationsChange(value: string): void {
    this.cart.setObservations(value);
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

  protected onPaymentAdd(payment: NewPurchasePayment): void {
    this.cart.addPayment(payment.paymentMethod, payment.amount);
  }

  protected onPaymentRemove(index: number): void {
    this.cart.removePayment(index);
  }

  protected onConfirm(): void {
    if (!this.canConfirm() || this.submitting()) {
      return;
    }

    const request = this.buildRequest();
    if (!request) {
      return;
    }

    this.submitting.set(true);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (order) => {
        this.submitting.set(false);
        this.onSubmitted(order);
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.onSubmitFailed(error);
      },
    });
  }

  /** El request que cierra la pantalla: el commit en el alta, la conversión en la edición. */
  private buildRequest(): Observable<OrderDto> | null {
    if (this.isEdit) {
      const payload = this.buildConvertPayload();
      return this.orderUuid && payload ? this.ordersApi.convert(this.orderUuid, payload) : null;
    }

    const payload = this.buildCommitPayload();
    return payload ? this.ordersApi.commit(payload) : null;
  }

  private onSubmitted(order: OrderDto): void {
    const total = order.orderCheckout?.totalAmount ?? this.cart.totals().totalAmount;

    this.toast.success(
      this.translate.instant(this.successMessageKey(), {
        // Hoy la sucursal numera todas las operaciones, fiscales incluidas; el fallback queda por
        // si el día de mañana el circuito fiscal se lleva la numeración y el número no vuelve.
        publicId: order.publicId ?? this.translate.instant('purchases.toasts.pendingNumber'),
        total: this.formatAmount(total),
      }),
    );

    if (this.isEdit) {
      // La orden ya no está como se la abrió: lo que corresponde es volver a verla en la lista.
      this.goToList();
      return;
    }

    // Proveedor, comprobante y fecha sobreviven: lo habitual es descargar varios comprobantes del
    // mismo proveedor de una sentada.
    this.cart.clearCart();
    this.productSearch()?.focus();
  }

  /** Qué se acaba de hacer, que es lo que el comprobante elegido decide. */
  private successMessageKey(): string {
    if (!this.isEdit) {
      return this.isDraftOrder()
        ? 'purchases.toasts.orderCompleted'
        : 'purchases.toasts.purchaseCompleted';
    }

    return this.isDraftOrder()
      ? 'purchases.toasts.orderUpdated'
      : 'purchases.toasts.orderConverted';
  }

  /**
   * No hay 409 de stock que interpretar: ni el commit ni la conversión validan el inventario cuando
   * el comprobante **incrementa**, que es lo que hacen los de compra. Lo que sí puede llegar es el
   * `400 Sin sesión de caja` cuando la fecha elegida no cae en ninguna sesión — un caso que la
   * pantalla no puede anticipar para fechas pasadas, y por eso el mensaje del backend se muestra
   * tal cual.
   *
   * Los dos 409 de la conversión sí se traducen: sus mensajes hablan de versiones y de efectos de
   * comprobante, y lo que hay que hacer en ambos casos es lo mismo —volver al listado, que ya no
   * dice lo que decía—.
   */
  private onSubmitFailed(error: unknown): void {
    if (this.isEdit) {
      if (hasApiErrorCode(error, API_ERROR_CODES.VERSION_CONFLICT)) {
        this.toast.error(this.translate.instant('purchases.toasts.versionConflict'));
        return;
      }

      if (hasApiErrorCode(error, API_ERROR_CODES.ORDER_ALREADY_APPLIED)) {
        this.toast.error(this.translate.instant('purchases.toasts.alreadyApplied'));
        return;
      }
    }

    this.toast.error(
      resolveApiErrorMessage(
        error,
        this.translate.instant(
          this.isEdit ? 'purchases.toasts.convertError' : 'purchases.toasts.commitError',
        ),
      ),
    );
  }

  private buildCommitPayload(): OrderCommitPayload | null {
    const supplier = this.cart.supplier();
    const voucher = this.cart.voucher();
    const cashRegisterUuid = this.cashRegisterUuid();

    if (!supplier || !voucher || !cashRegisterUuid) {
      return null;
    }

    const observations = this.cart.observations().trim();

    return {
      voucher: { uuid: voucher.uuid },
      partyRole: { uuid: supplier.uuid },
      cashRegister: { uuid: cashRegisterUuid },
      dateOperation: toLocalDateTime(this.cart.dateOperation()),
      // La nota en blanco no viaja: el backend la guardaría como `null` de todos modos.
      ...(observations ? { observations } : {}),
      items: this.buildItems(),
      orderCheckout: { payments: this.buildPayments() },
    };
  }

  /**
   * El body de `POST /order/{uuid}/convert`.
   *
   * A diferencia del commit, la caja es opcional —sin ella el backend usa la de la orden— y el
   * proveedor viaja **siempre**: el controller decide con él si exige `purchase.edit` o `order.edit`,
   * así que omitirlo por redundante le respondería 403 a quien sí puede editar compras.
   */
  private buildConvertPayload(): OrderConvertPayload | null {
    const supplier = this.cart.supplier();
    const voucher = this.cart.voucher();
    const version = this.orderVersion();

    if (!supplier || !voucher || version === null) {
      return null;
    }

    const observations = this.cart.observations().trim();
    const cashRegisterUuid = this.cashRegisterUuid();

    return {
      version,
      voucher: { uuid: voucher.uuid },
      partyRole: { uuid: supplier.uuid },
      ...(cashRegisterUuid ? { cashRegister: { uuid: cashRegisterUuid } } : {}),
      dateOperation: toLocalDateTime(this.cart.dateOperation()),
      // Reenviado tal cual: la conversión pisa la orden, y omitirlo lo dejaría en `null`.
      ...(this.orderExpiresAt ? { expiresAt: this.orderExpiresAt } : {}),
      /*
       * Va siempre, incluso en blanco. Acá el campo ausente no significa "sin nota" sino "dejá la
       * que estaba", así que omitirlo cuando el operador la borró le devolvería la anterior; la
       * cadena vacía es lo que el backend normaliza a `null`.
       */
      observations,
      items: this.buildItems(),
      orderCheckout: { payments: this.buildPayments() },
    };
  }

  private buildItems(): OrderCommitItem[] {
    return this.cart.lines().map((line) => ({
      product: { uuid: line.product.uuid },
      quantity: line.quantity,
      // El costo por unidad. En compra es obligatorio: sin él el backend responde 400.
      unitPrice: line.unitCost ?? 0,
      // Las partidas en las que entra la mercadería, sólo en un producto que las lleva: el backend
      // las abre o las alimenta por número y vencimiento (§7.2).
      ...(isBatchTracked(line.product)
        ? {
            batches: line.batches.map((batch) => ({
              batchNumber: batch.batchNumber.trim(),
              ...(batch.expirationDate ? { expirationDate: batch.expirationDate } : {}),
              quantity: batch.quantity ?? 0,
            })),
          }
        : {}),
      // Los números de serie, uno por unidad. La cantidad de la línea es la cantidad de series
      // (RN-17): el carrito las mantiene iguales, así que acá no hay nada que reconciliar.
      ...(isSerialTracked(line.product) ? { serials: [...line.serials] } : {}),
    }));
  }

  /** Con un comprobante sin efecto contable el checkout va vacío: mandar pagos es un 400. */
  private buildPayments(): OrderCommitPayment[] {
    if (!this.cart.requiresPayment()) {
      return [];
    }

    return this.cart.payments().map((payment) => ({
      paymentMethod: { uuid: payment.paymentMethod.uuid },
      amount: payment.amount,
    }));
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
   *
   * Editando **no** se recuerda: la caja que se resuelve es la de la orden —vieja, probablemente
   * cerrada— y escribirla en la preferencia le cambiaría la caja activa al usuario en toda la app
   * por haber abierto una orden de la semana pasada. El convert no lee el header: cae a la caja de
   * la orden, y la elegida viaja en el cuerpo.
   */
  private useCashRegister(uuid: string | null): void {
    this.cashRegisterUuid.set(uuid);

    if (uuid && !this.isEdit) {
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
 * Con qué comprobante arranca la pantalla. El catálogo que llega ya son todos de compra, así que lo
 * que queda por elegir es cuál: se prefiere el primero que además **paga** —ingresa stock y debita
 * balance—, que es lo que documenta una compra hecha. Ordenado por nombre, el primero podría ser una
 * orden de compra o un presupuesto, que no mueven ni stock ni cuenta.
 */
function pickDefaultVoucher(vouchers: readonly PurchaseVoucherDto[]): PurchaseVoucherDto | null {
  const invoice = vouchers.find(
    (voucher) => voucher.stockEffect === 'INCREMENT' && voucher.balanceEffect === 'DECREMENT',
  );

  return invoice ?? vouchers[0] ?? null;
}
