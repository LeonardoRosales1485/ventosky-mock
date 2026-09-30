import {
  Component,
  DestroyRef,
  OnInit,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormField, form, maxLength, required, submit, validate } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Observable,
  catchError,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  forkJoin,
  of,
  skip,
  switchMap,
} from 'rxjs';
import {
  CategoryOption,
  coveredCategoryUuids,
  rootCategoryUuids,
} from '../../../../core/category/category-options';
import { VersionConflictService } from '../../../../core/concurrency/version-conflict.service';
import { parseIsoDate, toIsoDate, todayIso } from '../../../../core/date/iso-date';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { UuidNameRef } from '../../../../core/http/api-refs';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  HasUnsavedChanges,
  trackUnsavedChanges,
} from '../../../../core/unsaved-changes/unsaved-changes.tracker';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import {
  CustomerOption,
  DEFAULT_PROMOTION_SCOPE,
  DEFAULT_PROMOTION_TYPE,
  PERCENT_MAX,
  PROMOTION_SCOPES,
  ProductOption,
  PromotionDto,
  PromotionFormValue,
  PromotionIssue,
  defaultCombinableFor,
  promotionValidationIssues,
  toPromotionFormValue,
  toPromotionSavePayload,
  typeOptionsFor,
  typeParamsOf,
} from '../../data-access/promotion.model';
import { PromotionsApiService } from '../../data-access/promotions-api.service';
import { PROMOTIONS_PATHS } from '../../promotions.paths';

const NAME_MAX_LENGTH = 255;

/** `promotions.description` del backend es `varchar(500)`. */
const DESCRIPTION_MAX_LENGTH = 500;

/** Caracteres mínimos antes de consultar un buscador. */
const SEARCH_MIN_LENGTH = 2;

/** Una categoría del select, con el estado que le da la selección actual. */
interface CategoryChoice extends CategoryOption {
  /** Alcanzada por una categoría superior ya elegida: se ve tildada, pero no se puede destildar sola. */
  covered: boolean;
}

/**
 * Alta y edición de una promoción, en las siete secciones del wireframe: datos generales, tipo y
 * valor, ámbito, audiencia, medios de pago, sucursales y vigencia.
 *
 * El formulario muestra **sólo los campos del tipo elegido** —un porcentaje no tiene N ni M— y
 * explica en cada paso las reglas que el usuario no puede adivinar: que dos porcentajes acumulados
 * descuentan 14,5 % y no 15 %, que el monto fijo se expresa en precio final, que un NxM bonifica la
 * unidad de menor valor **de cada grupo**, y que la condición por medio de pago es todo-o-nada.
 *
 * **El solapamiento no se impide.** Dos promociones pueden alcanzar el mismo producto y lo resuelve
 * el motor: es la diferencia con las reglas de precio, donde el backend rechaza el par y un producto
 * tiene una sola regla por sucursal. Acá el formulario puede advertir, nunca bloquear.
 *
 * Los dos pickers del paso 3 —productos con búsqueda server-side, categorías con el subárbol
 * heredado— son los de las reglas de precio: su aritmética vive en `core/category`.
 */
@Component({
  selector: 'app-promotion-form-page',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatSelectModule,
    MatTooltipModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    LoadStateComponent,
    PageHeaderComponent,
  ],
  // El calendario nativo cae al locale del navegador, que en una máquina en inglés mostraría
  // `9/18/2026` en una pantalla que el resto del tiempo escribe en español.
  providers: [
    PromotionsApiService,
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useFactory: () => inject(LanguageService).localeId() },
  ],
  templateUrl: './promotion-form.page.html',
  styleUrl: './promotion-form.page.css',
})
export class PromotionFormPage implements OnInit, HasUnsavedChanges {
  private readonly promotionsApi = inject(PromotionsApiService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly LoadState = LoadState;

  protected readonly promotionScopes = PROMOTION_SCOPES;
  protected readonly percentMax = PERCENT_MAX;

  /** `uuid` de la ruta: sólo lo trae `:uuid/edit`, y es lo que distingue edición de alta. */
  private readonly promotionUuid = this.route.snapshot.paramMap.get('uuid');
  protected readonly isEdit = this.promotionUuid !== null;

  /** Nombre ya guardado de la promoción, para el breadcrumb de la edición. */
  private readonly promotionName = signal('');

  /**
   * Versión que traía la promoción en la lectura que hidrató la pantalla. Se reenvía al guardar para
   * que el backend pueda detectar si alguien más la editó mientras el formulario estaba abierto.
   * Queda en `undefined` en un alta. No es señal: nada de la vista depende de ella.
   */
  private promotionVersion: number | undefined;

  protected readonly loadState = signal<LoadState>(LoadState.Loading);

  protected readonly categoryOptions = signal<readonly CategoryOption[]>([]);
  protected readonly branchOptions = signal<readonly UuidNameRef[]>([]);
  protected readonly paymentMethodOptions = signal<readonly UuidNameRef[]>([]);

  /**
   * Nombre de cada producto y cada cliente vinculado. Viven fuera del modelo porque son sólo para
   * mostrar: lo que se guarda —y lo que el guard de salida compara— son los uuids.
   */
  private readonly productNames = signal<ReadonlyMap<string, string>>(new Map());
  private readonly customerNames = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly productSearch = signal('');
  protected readonly productResults = signal<readonly ProductOption[]>([]);
  protected readonly productSearching = signal(false);

  protected readonly customerSearch = signal('');
  protected readonly customerResults = signal<readonly CustomerOption[]>([]);
  protected readonly customerSearching = signal(false);

  private readonly categoryOptionsByUuid = computed(
    () => new Map(this.categoryOptions().map((option) => [option.uuid, option])),
  );

  private readonly model = signal<PromotionFormValue>({
    name: '',
    description: '',
    type: DEFAULT_PROMOTION_TYPE,
    scope: DEFAULT_PROMOTION_SCOPE,
    percent: null,
    amount: null,
    buyQuantity: null,
    payQuantity: null,
    // El alta arranca vigente hoy: es la promoción que alguien viene a cargar para usarla ya.
    validFrom: todayIso(),
    validUntil: null,
    isDiscontinued: false,
    isCombinable: true,
    productUuids: [],
    categoryUuids: [],
    customerUuids: [],
    branchUuids: [],
    paymentMethodUuids: [],
  });

  /** La foto se toma al terminar de cargar y otra vez después de guardar. */
  private readonly changes = trackUnsavedChanges(this.model);

  /** Público, sin `protected`: lo lee `unsavedChangesGuard` desde afuera del componente. */
  readonly hasUnsavedChanges = this.changes.hasUnsavedChanges;

  /**
   * Las reglas del ABM sobre lo cargado, resueltas **una sola vez** por cambio y compartidas por
   * todos los campos. Son las mismas que valida el backend (V2 a V7), así que el usuario las ve
   * antes de guardar en vez de descubrirlas en la respuesta.
   */
  private readonly issues = computed(() => promotionValidationIssues(this.model()));

  protected readonly promotionForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
    maxLength(path.description, DESCRIPTION_MAX_LENGTH);
    required(path.type);
    required(path.scope);

    // Cada regla se reporta en el campo que la puede arreglar, pero la definición es una sola:
    // `promotionValidationIssues`, que es también lo que está probado.
    validate(path.percent, () => this.errorFor('percentRange', { max: PERCENT_MAX }));
    validate(path.amount, () => this.errorFor('amountPositive'));
    validate(path.buyQuantity, () => this.errorFor('nxmQuantities'));
    validate(path.payQuantity, () => this.errorFor('nxmQuantities'));
    validate(path.scope, () => this.errorFor('nxmRequiresProducts'));
    validate(path.productUuids, () => this.errorFor('eligibleSetRequired'));
    validate(path.validFrom, () => this.errorFor('validFromRequired'));
    validate(path.validUntil, () => this.errorFor('datesInverted'));
  });

  /**
   * Si ya se intentó guardar. Los errores que no viven en un input —el conjunto elegible vacío, el
   * ámbito que el tipo no admite— se muestran recién a partir de acá: un formulario de alta abre con
   * el conjunto vacío por definición, y pintarlo de rojo antes de que el usuario haga nada sería
   * retarlo por no haber empezado.
   */
  private readonly submitAttempted = signal(false);

  protected readonly showSectionErrors = this.submitAttempted.asReadonly();

  protected readonly saving = computed(() => this.promotionForm().submitting());

  /** Qué tipo está elegido, que es lo que decide qué campos se dibujan (sin inputs muertos). */
  protected readonly selectedType = computed(() => this.promotionForm.type().value());

  /**
   * Los tipos que el selector ofrece. Sale de {@link typeOptionsFor} y no de la lista completa: hoy
   * el ABM ofrece sólo la porcentual (ver `ALL_PROMOTION_TYPES_ENABLED`).
   *
   * Depende del tipo elegido porque una promoción **ya guardada** con un tipo que dejó de ofrecerse
   * conserva el suyo en la lista. Si no, el select abriría en blanco y el primer cambio en cualquier
   * otro campo la guardaría convertida en otra cosa.
   */
  protected readonly typeOptions = computed(() => typeOptionsFor(this.selectedType()));

  /** Un NxM cuenta unidades elegibles, así que su ámbito es siempre el de productos. */
  protected readonly isNxm = computed(() => this.selectedType() === 'NXM');
  protected readonly isProductsScope = computed(
    () => this.promotionForm.scope().value() === 'PRODUCTS',
  );

  protected readonly validFromDate = computed(() => {
    const value = this.promotionForm.validFrom().value();
    return value ? parseIsoDate(value) : null;
  });

  protected readonly validUntilDate = computed(() => {
    const value = this.promotionForm.validUntil().value();
    return value ? parseIsoDate(value) : null;
  });

  protected readonly selectedProducts = computed<readonly UuidNameRef[]>(() => {
    const names = this.productNames();
    return this.promotionForm
      .productUuids()
      .value()
      .map((uuid) => ({ uuid, name: names.get(uuid) ?? uuid }));
  });

  protected readonly selectedCustomers = computed<readonly UuidNameRef[]>(() => {
    const names = this.customerNames();
    return this.promotionForm
      .customerUuids()
      .value()
      .map((uuid) => ({ uuid, name: names.get(uuid) ?? uuid }));
  });

  protected readonly selectedCategories = computed<readonly CategoryOption[]>(() => {
    const optionsByUuid = this.categoryOptionsByUuid();
    return this.promotionForm
      .categoryUuids()
      .value()
      .map(
        (uuid) =>
          optionsByUuid.get(uuid) ?? {
            uuid,
            name: uuid,
            depth: 0,
            path: uuid,
            ancestorUuids: [],
            descendantUuids: [],
          },
      );
  });

  /**
   * Subcategorías alcanzadas por herencia: no están en el modelo —lo que se guarda son las raíces—,
   * pero el select las muestra tildadas y bloqueadas, porque la promoción ya las alcanza igual.
   */
  private readonly coveredCategories = computed<ReadonlySet<string>>(() =>
    coveredCategoryUuids(this.promotionForm.categoryUuids().value(), this.categoryOptionsByUuid()),
  );

  protected readonly categoryChoices = computed<readonly CategoryChoice[]>(() => {
    const covered = this.coveredCategories();
    return this.categoryOptions().map((option) => ({
      ...option,
      covered: covered.has(option.uuid),
    }));
  });

  /** Lo tildado en el select: las elegidas más su descendencia, que es el alcance real. */
  protected readonly categorySelection = computed<string[]>(() => [
    ...new Set([...this.promotionForm.categoryUuids().value(), ...this.coveredCategories()]),
  ]);

  /** El trigger nombra sólo las raíces: repetir el subárbol lo volvería ilegible. */
  protected readonly categorySelectionLabel = computed(() =>
    this.selectedCategories()
      .map((category) => category.name)
      .join(', '),
  );

  /** Los ya vinculados no vuelven a ofrecerse: agregarlos dos veces no cambia nada. */
  protected readonly productSuggestions = computed<readonly ProductOption[]>(() => {
    const selected = new Set(this.promotionForm.productUuids().value());
    return this.productResults().filter((product) => !selected.has(product.uuid));
  });

  protected readonly customerSuggestions = computed<readonly CustomerOption[]>(() => {
    const selected = new Set(this.promotionForm.customerUuids().value());
    return this.customerResults().filter((customer) => !selected.has(customer.uuid));
  });

  /** «Llevando 3, paga 2»: la vista previa textual del NxM, con lo que de verdad se bonifica. */
  protected readonly nxmPreview = computed(() => {
    const buy = this.promotionForm.buyQuantity().value();
    const pay = this.promotionForm.payQuantity().value();
    if (buy == null || pay == null || buy <= pay || pay < 1) {
      return null;
    }

    return { buy, pay, bonused: buy - pay };
  });

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.promotions', link: PROMOTIONS_PATHS },
      this.isEdit
        ? this.promotionName()
          ? { label: this.promotionName() }
          : { labelKey: 'promotions.form.editTitle' }
        : { labelKey: 'promotions.form.createTitle' },
    ]);

    this.wireSearch(
      this.productSearch,
      this.productSearching,
      this.productResults,
      (term) => this.promotionsApi.searchProducts(term),
      'promotions.toasts.productSearchError',
    );

    this.wireSearch(
      this.customerSearch,
      this.customerSearching,
      this.customerResults,
      (term) => this.promotionsApi.searchCustomers(term),
      'promotions.toasts.customerSearchError',
    );
  }

  ngOnInit(): void {
    this.loadCatalogues();
  }

  protected onCancel(): void {
    void this.router.navigate([PROMOTIONS_PATHS]);
  }

  protected onRetry(): void {
    this.loadCatalogues();
  }

  /**
   * Cambiar de tipo **borra los parámetros de los otros**: el backend rechaza una NxM que viaja con
   * `percent` (V9), y dejarlos en pantalla sería mostrar campos muertos. Elegir NxM fuerza además el
   * ámbito de productos, para no cargar una combinación que el sistema va a rechazar.
   */
  protected onTypeChange(type: string): void {
    this.model.update((current) => ({
      ...current,
      type,
      // Qué parámetros sobreviven al cambio lo decide `typeParamsOf`, que es lo mismo que decide qué
      // se manda al guardar: si los dos no coincidieran, el backend rechazaría el guardado por V9.
      ...typeParamsOf({ ...current, type }),
      scope: type === 'NXM' ? 'PRODUCTS' : current.scope,
      // Las NxM nacen no acumulables (§4.7), y el usuario puede cambiarlo después. Sólo se impone al
      // pasar a NxM: volver a un porcentaje no le devuelve la acumulabilidad que el usuario apagó.
      isCombinable: type === 'NXM' ? defaultCombinableFor(type) : current.isCombinable,
    }));
    this.promotionForm.type().markAsTouched();
  }

  protected onScopeChange(scope: string): void {
    this.model.update((current) => ({ ...current, scope }));
    this.promotionForm.scope().markAsTouched();
  }

  protected onProductSearchInput(event: Event): void {
    this.productSearch.set((event.target as HTMLInputElement).value);
  }

  protected onProductSelected(product: ProductOption): void {
    this.productNames.update((names) => new Map(names).set(product.uuid, product.name));
    this.model.update((current) =>
      current.productUuids.includes(product.uuid)
        ? current
        : { ...current, productUuids: [...current.productUuids, product.uuid] },
    );

    // El input vuelve a quedar vacío: la próxima búsqueda arranca de cero, no del elegido.
    this.productSearch.set('');
    this.productResults.set([]);
  }

  protected onRemoveProduct(uuid: string): void {
    this.model.update((current) => ({
      ...current,
      productUuids: current.productUuids.filter((selected) => selected !== uuid),
    }));
  }

  protected onCustomerSearchInput(event: Event): void {
    this.customerSearch.set((event.target as HTMLInputElement).value);
  }

  protected onCustomerSelected(customer: CustomerOption): void {
    this.customerNames.update((names) => new Map(names).set(customer.uuid, customer.name));
    this.model.update((current) =>
      current.customerUuids.includes(customer.uuid)
        ? current
        : { ...current, customerUuids: [...current.customerUuids, customer.uuid] },
    );

    this.customerSearch.set('');
    this.customerResults.set([]);
  }

  protected onRemoveCustomer(uuid: string): void {
    this.model.update((current) => ({
      ...current,
      customerUuids: current.customerUuids.filter((selected) => selected !== uuid),
    }));
  }

  protected onBranchesChange(uuids: string[]): void {
    this.model.update((current) => ({ ...current, branchUuids: uuids }));
  }

  protected onPaymentMethodsChange(uuids: string[]): void {
    this.model.update((current) => ({ ...current, paymentMethodUuids: uuids }));
  }

  protected onDiscontinuedChange(isDiscontinued: boolean): void {
    this.model.update((current) => ({ ...current, isDiscontinued }));
  }

  protected onCombinableChange(isCombinable: boolean): void {
    this.model.update((current) => ({ ...current, isCombinable }));
  }

  protected onValidFromChange(date: Date | null): void {
    this.model.update((current) => ({ ...current, validFrom: date ? toIsoDate(date) : '' }));
    this.promotionForm.validFrom().markAsTouched();
  }

  /** Vaciar la fecha de fin es válido: la promoción corre hasta que alguien la discontinúe. */
  protected onValidUntilChange(date: Date | null): void {
    this.model.update((current) => ({ ...current, validUntil: date ? toIsoDate(date) : null }));
    this.promotionForm.validUntil().markAsTouched();
  }

  protected onClearValidUntil(): void {
    this.model.update((current) => ({ ...current, validUntil: null }));
  }

  /**
   * El select emite lo tildado, y ahí conviven lo elegido y lo heredado. Como las opciones heredadas
   * están deshabilitadas, la diferencia contra la selección anterior es siempre una decisión del
   * usuario: lo que aparece es una categoría nueva y lo que falta es una que destildó.
   *
   * Destildar una raíz no destilda a sus hijas en el select —siguen tildadas, sólo que ya sin quién
   * las cubra—, así que las heredadas nunca se reconstruyen desde lo emitido: se derivan de nuevo de
   * las raíces que quedan.
   */
  protected onCategoriesChange(uuids: string[]): void {
    const previous = new Set(this.categorySelection());
    const stillChecked = new Set(uuids);

    const added = uuids.filter((uuid) => !previous.has(uuid));
    const kept = this.promotionForm
      .categoryUuids()
      .value()
      .filter((uuid) => stillChecked.has(uuid));

    this.setCategories([...kept, ...added]);
  }

  protected onRemoveCategory(uuid: string): void {
    this.setCategories(
      this.promotionForm
        .categoryUuids()
        .value()
        .filter((selected) => selected !== uuid),
    );
  }

  /** Guarda sólo las raíces: elegir un padre absorbe a las hijas que ya estuvieran elegidas. */
  private setCategories(uuids: readonly string[]): void {
    this.model.update((current) => ({
      ...current,
      categoryUuids: rootCategoryUuids(uuids, this.categoryOptionsByUuid()),
    }));
    this.promotionForm.categoryUuids().markAsTouched();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.submitAttempted.set(true);

    if (this.promotionForm().invalid()) {
      this.promotionForm().markAsTouched();
      return;
    }

    void submit(this.promotionForm, async () => {
      try {
        const outcome = await firstValueFrom(
          this.versionConflict.saveGuarded<PromotionDto, PromotionDto>({
            uuid: this.promotionUuid ?? undefined,
            version: this.promotionVersion,
            // El payload se rearma en cada intento: sobrescribir reenvía lo mismo con otra versión,
            // y el interceptor de auth puede repetir el request tras refrescar el token.
            save: (version) =>
              this.promotionsApi.save(
                toPromotionSavePayload(this.model(), this.promotionUuid ?? undefined, version),
              ),
            fetchLatest: (uuid) => this.promotionsApi.getByUuid(uuid),
            label: this.model().name.trim(),
            // El formulario sigue en pantalla detrás del diálogo, así que cancelar es una salida
            // honesta: no se pierde nada y el usuario decide después.
            allowCancel: true,
          }),
        );

        // El conflicto llega como valor, no como excepción: sin mirar `kind` se daría por guardado
        // algo que el usuario canceló o que se recargó descartando sus cambios.
        if (outcome.kind === 'cancelled') {
          return undefined;
        }

        if (outcome.kind === 'reloaded') {
          this.hydrate(outcome.latest);
          // El usuario ya aceptó descartar lo suyo: sin renovar la foto el guard le frenaría la
          // próxima navegación por cambios que él mismo decidió tirar.
          this.changes.capture();
          this.toast.info(this.translate.instant('versionConflict.reloaded'));
          return undefined;
        }

        this.toast.success(
          this.translate.instant(
            this.isEdit ? 'promotions.toasts.updated' : 'promotions.toasts.created',
            { name: outcome.value.name },
          ),
        );
        // La respuesta trae la versión ya incrementada: si al editar la navegación no llegara a
        // ocurrir, el próximo guardado saldría con la vigente en vez de chocar contra sí mismo.
        this.promotionVersion = outcome.value.version;
        // Lo cargado ya está persistido: sin renovar la foto, el guard frenaría esta navegación.
        this.changes.capture();
        await this.router.navigate([PROMOTIONS_PATHS]);
      } catch (error) {
        // El backend contesta con el código de la regla que falló (`PROMOTION_*`), y ese mensaje es
        // lo único que le dice al usuario qué tiene que cambiar cuando la validación no vivía acá —
        // una referencia archivada, un cliente que no es cliente (V8).
        this.toast.error(
          resolveApiErrorMessage(error, this.translate.instant('promotions.toasts.saveError')),
        );
      }

      return undefined;
    });
  }

  /** La regla como error de Signal Forms, o `null` si no está incumplida. */
  private errorFor(kind: PromotionIssue, extra?: Record<string, number>): { kind: string } | null {
    return this.issues().includes(kind) ? { kind, ...extra } : null;
  }

  /**
   * Un buscador con debounce, mínimo de caracteres y el error contenido en un toast: el de productos
   * y el de clientes son el mismo mecanismo con otro endpoint, y escribirlo dos veces era la forma de
   * que uno de los dos se quedara sin el `skip(1)` y buscara al abrir la pantalla.
   */
  private wireSearch<T>(
    term: WritableSignal<string>,
    searching: WritableSignal<boolean>,
    results: WritableSignal<readonly T[]>,
    search: (term: string) => Observable<readonly T[]>,
    errorKey: string,
  ): void {
    toObservable(term)
      .pipe(
        skip(1),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((raw) => {
          const trimmed = raw.trim();
          if (trimmed.length < SEARCH_MIN_LENGTH) {
            searching.set(false);
            return of<readonly T[]>([]);
          }

          searching.set(true);
          return search(trimmed).pipe(
            catchError(() => {
              this.toast.error(this.translate.instant(errorKey));
              return of<readonly T[]>([]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((found) => {
        results.set(found);
        searching.set(false);
      });
  }

  /**
   * Los catálogos de los selects. Cada uno falla por separado —un error deja ese select vacío, no la
   * pantalla—; el detalle de la promoción es la excepción: en la edición no hay nada que mostrar sin
   * él, así que su error deja la pantalla en estado de error con reintento en vez de abrir un
   * formulario vacío que pisaría la promoción al guardar.
   */
  private loadCatalogues(): void {
    this.loadState.set(LoadState.Loading);

    forkJoin({
      categories: this.promotionsApi.getCategoryOptions().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('promotions.toasts.categoriesError'));
          return of([] as CategoryOption[]);
        }),
      ),
      branches: this.promotionsApi.getBranches().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('promotions.toasts.branchesError'));
          return of([] as UuidNameRef[]);
        }),
      ),
      paymentMethods: this.promotionsApi.getPaymentMethods().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('promotions.toasts.paymentMethodsError'));
          return of([] as UuidNameRef[]);
        }),
      ),
      promotion: this.promotionUuid
        ? this.promotionsApi.getByUuid(this.promotionUuid)
        : of(null as PromotionDto | null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.categoryOptions.set(data.categories);
          this.branchOptions.set(data.branches);
          this.paymentMethodOptions.set(data.paymentMethods);

          if (data.promotion) {
            this.hydrate(data.promotion);
          }

          this.changes.capture();
          this.loadState.set(LoadState.Success);
        },
        error: () => {
          this.loadState.set(LoadState.Error);
        },
      });
  }

  /**
   * Vuelca la promoción guardada en el formulario. Las referencias llegan como `{ uuid, name }`, así
   * que los nombres se cachean para los chips: sin eso, editar una promoción mostraría uuids hasta
   * que el usuario buscara cada producto de nuevo.
   *
   * Sucursales y medios de pago se reponen en su catálogo si ya no vinieran: uno que salió de
   * circulación después de crear la promoción dejaría el select sin la opción, y guardar lo
   * desvincularía en silencio.
   */
  private hydrate(promotion: PromotionDto): void {
    this.promotionName.set(promotion.name);
    // Corre también al recargar tras un conflicto, y ahí es lo que importa: la pantalla queda parada
    // sobre la versión que acaba de leer, así el siguiente guardado no vuelve a chocar por lo mismo.
    this.promotionVersion = promotion.version;

    this.productNames.set(refNames(promotion.products));
    this.customerNames.set(refNames(promotion.customers));

    this.branchOptions.update((options) => mergeMissingOptions(options, promotion.branches));
    this.paymentMethodOptions.update((options) =>
      mergeMissingOptions(options, promotion.paymentMethods),
    );

    this.model.set(toPromotionFormValue(promotion));
  }
}

function refNames(refs: readonly UuidNameRef[] | null | undefined): ReadonlyMap<string, string> {
  return new Map((refs ?? []).map((ref) => [ref.uuid, ref.name]));
}

/** Agrega al catálogo las referencias que la promoción usa y el catálogo ya no trae. */
function mergeMissingOptions(
  options: readonly UuidNameRef[],
  used: readonly UuidNameRef[] | null | undefined,
): UuidNameRef[] {
  const known = new Set(options.map((option) => option.uuid));
  const missing = (used ?? []).filter((ref) => ref?.uuid && !known.has(ref.uuid));

  return [...options, ...missing];
}
