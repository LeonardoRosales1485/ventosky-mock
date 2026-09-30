import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FormField,
  applyEach,
  form,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  forkJoin,
  of,
  skip,
  switchMap,
} from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import {
  CategoryOption,
  coveredCategoryUuids,
  rootCategoryUuids,
} from '../../../../core/category/category-options';
import { VersionConflictService } from '../../../../core/concurrency/version-conflict.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
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
  DEFAULT_PRICE_ROUNDING_DIRECTION,
  DEFAULT_PRICE_ROUNDING_MODE,
  DEFAULT_PRICE_RULE_TYPE,
  MARGIN_PERCENT_MAX,
  PRICE_ROUNDING_DIRECTIONS,
  PRICE_ROUNDING_MODES,
  PRICE_RULE_TYPES,
  PriceListOption,
  PriceRuleDto,
  PriceRulePriceListDto,
  PriceRuleSavePayload,
  ProductOption,
  UuidNameRef,
  linkedCategoryRefs,
  linkedProductRefs,
  priceListRows,
  roundAmount,
  toPriceRounding,
} from '../../data-access/price-rule.model';
import { PriceRulesApiService } from '../../data-access/price-rules-api.service';
import { PRICE_RULES_PATHS } from '../../price-rules.paths';

const NAME_MAX_LENGTH = 255;

/**
 * Importe con el que el hint muestra el redondeo elegido. Es el mismo con el que el backend
 * documenta el enum, y con él las cinco combinaciones dan resultados distintos entre sí: elegir un
 * número redondo no mostraría nada.
 */
const ROUNDING_EXAMPLE_AMOUNT = 40.56;

/** Caracteres mínimos antes de consultar el buscador de productos. */
const PRODUCT_SEARCH_MIN_LENGTH = 2;

/**
 * Una fila de la grilla: qué lista recalcula la regla y con qué porcentaje. La sucursal no se elige:
 * es siempre la activa de la sesión, la que el usuario seleccionó al entrar.
 */
interface PriceRuleListRowModel {
  priceListUuid: string | null;
  percent: number | null;
}

interface PriceRuleFormModel {
  name: string;
  ruleType: string;
  /** A qué se redondea el precio que la regla calcula (`PriceRoundingMode`). */
  roundingMode: string;
  /** Para qué lado se redondea (`PriceRoundingDirection`). */
  roundingDirection: string;
  priceLists: PriceRuleListRowModel[];
  productUuids: string[];
  /** Sólo las raíces elegidas: sus subcategorías se derivan, no se guardan. */
  categoryUuids: string[];
}

/** Una categoría del select, con el estado que le da la selección actual. */
interface CategoryChoice extends CategoryOption {
  /** Alcanzada por una categoría superior ya elegida: se ve tildada, pero no se puede destildar sola. */
  covered: boolean;
}

/**
 * Alta y edición de una regla de precio.
 *
 * Una regla declara cómo se calcula el precio —el tipo de cálculo y el redondeo, que son dos campos:
 * a qué se redondea y para qué lado—, una **grilla de listas** (cada fila es *lista + porcentaje*) y
 * el conjunto de productos y categorías a los que aplica. La pantalla siempre opera sobre la
 * **sucursal activa** de la sesión: las filas que se editan acá son las suyas.
 *
 * Una regla puede tener filas de otras sucursales —las sucursales de la regla se derivan de la
 * grilla—, y el backend sincroniza la colección con lo que recibe: lo ausente se desvincula. Por eso
 * esas filas se conservan y se reenvían tal cual ({@link PriceRuleFormPage.otherBranchRows}); si no,
 * editar la regla desde una sucursal borraría en silencio lo que hace en las demás.
 *
 * Al guardar, el backend sincroniza las tres colecciones con lo enviado —lo ausente se desvincula— y
 * recalcula precios **según lo que haya cambiado**: si se tocó el cálculo (tipo, redondeo o la
 * grilla), todos los productos de la regla; si sólo se movieron los vínculos, los que entraron o
 * salieron; si sólo cambió el nombre, ninguno. Guardar no es sólo persistir la regla: mueve precios.
 */
@Component({
  selector: 'app-price-rule-form-page',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    LoadStateComponent,
    PageHeaderComponent,
  ],
  providers: [PriceRulesApiService],
  templateUrl: './price-rule-form.page.html',
  styleUrl: './price-rule-form.page.css',
})
export class PriceRuleFormPage implements OnInit, HasUnsavedChanges {
  private readonly priceRulesApi = inject(PriceRulesApiService);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly LoadState = LoadState;
  protected readonly ruleTypes = PRICE_RULE_TYPES;
  protected readonly roundingModes = PRICE_ROUNDING_MODES;
  protected readonly roundingDirections = PRICE_ROUNDING_DIRECTIONS;

  /** `uuid` de la ruta: sólo lo trae `:uuid/edit`, y es lo que distingue edición de alta. */
  private readonly ruleUuid = this.route.snapshot.paramMap.get('uuid');
  protected readonly isEdit = this.ruleUuid !== null;

  /** Nombre ya guardado de la regla, para el breadcrumb de la edición. */
  private readonly ruleName = signal('');

  /**
   * Versión que traía la regla en la lectura que hidrató la pantalla. Se reenvía al guardar para que
   * el backend pueda detectar si alguien más la editó mientras el formulario estaba abierto. Queda
   * en `undefined` en un alta, donde no hay registro previo con el que chocar. No es señal: nada de
   * la vista depende de ella.
   */
  private ruleVersion: number | undefined;

  protected readonly loadState = signal<LoadState>(LoadState.Loading);

  protected readonly priceListOptions = signal<readonly UuidNameRef[]>([]);
  protected readonly categoryOptions = signal<readonly CategoryOption[]>([]);

  /**
   * Sucursal sobre la que trabaja la pantalla: la de la sesión, elegida al entrar. Es también la que
   * viaja en el header `X-Branch-Uuid`, así que la regla se guarda donde el usuario está parado.
   */
  private readonly activeBranchUuid = this.auth.selectedBranchUuid;
  protected readonly activeBranchName = computed(
    () => this.auth.selectedBranch()?.name ?? this.activeBranchUuid() ?? '',
  );
  protected readonly hasActiveBranch = computed(() => this.activeBranchUuid() !== null);

  /**
   * Filas de la grilla que pertenecen a otras sucursales. No se editan acá, pero se reenvían tal
   * cual al guardar: el backend sincroniza `priceLists` con lo que recibe, así que omitirlas
   * desvincularía esas listas —y, con ellas, los productos y categorías de esas sucursales—.
   */
  private readonly otherBranchRows = signal<readonly PriceRulePriceListDto[]>([]);

  /**
   * Nombre de cada producto vinculado. Vive fuera del modelo del formulario porque es sólo para
   * mostrar: lo que se guarda —y lo que el guard de salida compara— son los uuids.
   */
  private readonly productNames = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly productSearch = signal('');
  protected readonly productResults = signal<readonly ProductOption[]>([]);
  protected readonly productSearching = signal(false);

  private readonly categoryOptionsByUuid = computed(
    () => new Map(this.categoryOptions().map((option) => [option.uuid, option])),
  );

  private readonly model = signal<PriceRuleFormModel>({
    name: '',
    ruleType: DEFAULT_PRICE_RULE_TYPE,
    roundingMode: DEFAULT_PRICE_ROUNDING_MODE,
    roundingDirection: DEFAULT_PRICE_ROUNDING_DIRECTION,
    // El alta arranca con una fila: una regla sin listas se resuelve pero no recalcula nada.
    priceLists: [emptyRow()],
    productUuids: [],
    categoryUuids: [],
  });

  /** La foto se toma al terminar de cargar y otra vez después de guardar. */
  private readonly changes = trackUnsavedChanges(this.model);

  /** Público, sin `protected`: lo lee `unsavedChangesGuard` desde afuera del componente. */
  readonly hasUnsavedChanges = this.changes.hasUnsavedChanges;

  protected readonly priceRuleForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
    required(path.ruleType);
    required(path.roundingMode);
    required(path.roundingDirection);

    applyEach(path.priceLists, (row) => {
      required(row.priceListUuid);
      required(row.percent);

      // Mismos límites que `PricingConfigService.validatePriceRuleConfig`, para no descubrir el
      // porcentaje inválido recién en la respuesta.
      validate(row.percent, ({ value, valueOf }) => {
        const percent = value();
        if (percent === null) {
          return null; // `required` ya reporta el vacío.
        }

        if (percent <= 0) {
          return { kind: 'percentPositive' };
        }

        const isMargin = valueOf(path.ruleType) === 'MARGIN_PERCENT';
        return isMargin && percent >= MARGIN_PERCENT_MAX
          ? { kind: 'percentMargin', max: MARGIN_PERCENT_MAX }
          : null;
      });
    });

    // Una lista no puede aparecer dos veces: en la misma sucursal serían dos porcentajes para el
    // mismo destino, que es lo que el backend rechaza con un 400.
    validate(path.priceLists, ({ value }) => {
      const seen = new Set<string>();

      for (const row of value()) {
        if (!row.priceListUuid) {
          continue;
        }

        if (seen.has(row.priceListUuid)) {
          return { kind: 'duplicatePriceListRow' };
        }
        seen.add(row.priceListUuid);
      }

      return null;
    });

    // Guard de linaje del backend: la misma regla no puede aplicarse a una categoría y a su padre o
    // hija a la vez. Los hermanos sí se permiten. El select ya sólo deja elegir raíces, así que esto
    // cubre lo que llega hidratado de una regla vieja.
    validate(path.categoryUuids, ({ value }) => {
      const selected = value();
      if (selected.length < 2) {
        return null;
      }

      const optionsByUuid = this.categoryOptionsByUuid();
      for (const uuid of selected) {
        const option = optionsByUuid.get(uuid);
        if (!option) {
          continue;
        }

        const lineage = [...option.ancestorUuids, ...option.descendantUuids];
        const conflict = selected.some((other) => other !== uuid && lineage.includes(other));
        if (conflict) {
          return { kind: 'categoryLineage' };
        }
      }

      return null;
    });
  });

  protected readonly saving = computed(() => this.priceRuleForm().submitting());

  /**
   * Qué le hace al precio el redondeo elegido, resuelto con la **misma** función que usa el punto de
   * venta para anticipar los importes. Un combo con dos campos ortogonales —«múltiplo de 10» y
   * «hacia abajo»— no se lee solo; el número sí.
   */
  protected readonly roundingExample = computed(() => {
    const rounding = toPriceRounding(
      this.priceRuleForm.roundingMode().value(),
      this.priceRuleForm.roundingDirection().value(),
    );
    const format = new Intl.NumberFormat(this.language.localeId(), { maximumFractionDigits: 2 });

    return {
      source: format.format(ROUNDING_EXAMPLE_AMOUNT),
      result: format.format(roundAmount(ROUNDING_EXAMPLE_AMOUNT, rounding)),
    };
  });

  protected readonly selectedProducts = computed<readonly UuidNameRef[]>(() => {
    const names = this.productNames();
    return this.priceRuleForm
      .productUuids()
      .value()
      .map((uuid) => ({ uuid, name: names.get(uuid) ?? uuid }));
  });

  protected readonly selectedCategories = computed<readonly CategoryOption[]>(() => {
    const optionsByUuid = this.categoryOptionsByUuid();
    return this.priceRuleForm
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
   * pero el select las muestra tildadas y bloqueadas, porque la regla ya las alcanza igual.
   */
  private readonly coveredCategories = computed<ReadonlySet<string>>(() =>
    coveredCategoryUuids(this.priceRuleForm.categoryUuids().value(), this.categoryOptionsByUuid()),
  );

  protected readonly categoryChoices = computed<readonly CategoryChoice[]>(() => {
    const covered = this.coveredCategories();
    return this.categoryOptions().map((option) => ({
      ...option,
      covered: covered.has(option.uuid),
    }));
  });

  /** Lo tildado en el select: las elegidas más su descendencia, que es el alcance real de la regla. */
  protected readonly categorySelection = computed<string[]>(() => [
    ...new Set([...this.priceRuleForm.categoryUuids().value(), ...this.coveredCategories()]),
  ]);

  /** El trigger nombra sólo las raíces: repetir el subárbol lo volvería ilegible. */
  protected readonly categorySelectionLabel = computed(() =>
    this.selectedCategories()
      .map((category) => category.name)
      .join(', '),
  );

  /** Los ya vinculados no vuelven a ofrecerse: agregarlos dos veces no cambia nada. */
  protected readonly productSuggestions = computed<readonly ProductOption[]>(() => {
    const selected = new Set(this.priceRuleForm.productUuids().value());
    return this.productResults().filter((product) => !selected.has(product.uuid));
  });

  /** Una regla sin listas se resuelve pero no mueve ningún precio: se avisa antes de guardarla. */
  protected readonly hasNoPriceLists = computed(
    () => this.priceRuleForm.priceLists().value().length === 0,
  );

  /** Sucursales, con su cantidad de listas, que la regla también recalcula fuera de acá. */
  protected readonly otherBranchesSummary = computed(() => {
    const rows = this.otherBranchRows();
    const names = [...new Set(rows.map((row) => row.branch?.name).filter(Boolean))];

    return { count: rows.length, branches: names.join(', ') };
  });

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.priceRules', link: PRICE_RULES_PATHS },
      this.isEdit
        ? this.ruleName()
          ? { label: this.ruleName() }
          : { labelKey: 'priceRules.form.editTitle' }
        : { labelKey: 'priceRules.form.createTitle' },
    ]);

    toObservable(this.productSearch)
      .pipe(
        skip(1),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const trimmed = term.trim();
          if (trimmed.length < PRODUCT_SEARCH_MIN_LENGTH) {
            this.productSearching.set(false);
            return of([] as ProductOption[]);
          }

          this.productSearching.set(true);
          return this.priceRulesApi.searchProducts(trimmed).pipe(
            catchError(() => {
              this.toast.error(this.translate.instant('priceRules.toasts.productSearchError'));
              return of([] as ProductOption[]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => {
        this.productResults.set(results);
        this.productSearching.set(false);
      });
  }

  ngOnInit(): void {
    this.loadCatalogues();
  }

  protected onCancel(): void {
    void this.router.navigate([PRICE_RULES_PATHS]);
  }

  protected onRetry(): void {
    this.loadCatalogues();
  }

  protected onRuleTypeChange(ruleType: string): void {
    this.priceRuleForm.ruleType().value.set(ruleType);
    this.priceRuleForm.ruleType().markAsTouched();
  }

  protected onRoundingModeChange(roundingMode: string): void {
    this.priceRuleForm.roundingMode().value.set(roundingMode);
    this.priceRuleForm.roundingMode().markAsTouched();
  }

  protected onRoundingDirectionChange(roundingDirection: string): void {
    this.priceRuleForm.roundingDirection().value.set(roundingDirection);
    this.priceRuleForm.roundingDirection().markAsTouched();
  }

  protected onRowPriceListChange(index: number, priceListUuid: string | null): void {
    this.updateRow(index, { priceListUuid });
  }

  protected onAddRow(): void {
    this.model.update((current) => ({
      ...current,
      priceLists: [...current.priceLists, emptyRow()],
    }));
  }

  protected onRemoveRow(index: number): void {
    this.model.update((current) => ({
      ...current,
      priceLists: current.priceLists.filter((_, position) => position !== index),
    }));
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

    // El input vuelve a quedar vacío: la próxima búsqueda arranca de cero, no del producto elegido.
    this.productSearch.set('');
    this.productResults.set([]);
  }

  protected onRemoveProduct(uuid: string): void {
    this.model.update((current) => ({
      ...current,
      productUuids: current.productUuids.filter((selected) => selected !== uuid),
    }));
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
    const kept = this.priceRuleForm
      .categoryUuids()
      .value()
      .filter((uuid) => stillChecked.has(uuid));

    this.setCategories([...kept, ...added]);
  }

  protected onRemoveCategory(uuid: string): void {
    this.setCategories(
      this.priceRuleForm
        .categoryUuids()
        .value()
        .filter((selected) => selected !== uuid),
    );
  }

  /** Guarda sólo las raíces: elegir un padre absorbe a las hijas que ya estuvieran elegidas. */
  private setCategories(uuids: readonly string[]): void {
    this.priceRuleForm
      .categoryUuids()
      .value.set(rootCategoryUuids(uuids, this.categoryOptionsByUuid()));
    this.priceRuleForm.categoryUuids().markAsTouched();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.priceRuleForm().invalid()) {
      this.priceRuleForm().markAsTouched();
      return;
    }

    void submit(this.priceRuleForm, async () => {
      try {
        const outcome = await firstValueFrom(
          this.versionConflict.saveGuarded<PriceRuleDto, PriceRuleDto>({
            uuid: this.ruleUuid ?? undefined,
            version: this.ruleVersion,
            // El payload se rearma en cada intento: sobrescribir reenvía lo mismo con otra versión,
            // y el interceptor de auth puede repetir el request tras refrescar el token.
            save: (version) => this.priceRulesApi.save(this.buildPayload(version)),
            fetchLatest: (uuid) => this.priceRulesApi.getByUuid(uuid),
            label: this.model().name.trim(),
            // Acá el formulario sigue en pantalla detrás del diálogo, así que cancelar es una salida
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
            this.isEdit ? 'priceRules.toasts.updated' : 'priceRules.toasts.created',
            { name: outcome.value.name },
          ),
        );
        // La respuesta trae la versión ya incrementada: si al editar la navegación no llegara a
        // ocurrir, el próximo guardado saldría con la vigente en vez de chocar contra sí mismo.
        this.ruleVersion = outcome.value.version;
        // Lo cargado ya está persistido: sin renovar la foto, el guard frenaría esta navegación.
        this.changes.capture();
        await this.router.navigate([PRICE_RULES_PATHS]);
      } catch (error) {
        // Unicidad y linaje llegan como 409 con el detalle de qué producto o categoría choca: ese
        // mensaje es lo único que le dice al usuario qué tiene que cambiar. `saveGuarded` sólo se
        // queda con el 409 del bloqueo optimista y deja pasar el resto hasta acá.
        this.toast.error(
          resolveApiErrorMessage(error, this.translate.instant('priceRules.toasts.saveError')),
        );
      }

      return undefined;
    });
  }

  private updateRow(index: number, patch: Partial<PriceRuleListRowModel>): void {
    this.model.update((current) => ({
      ...current,
      priceLists: current.priceLists.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    }));
  }

  private buildPayload(version: number | undefined): PriceRuleSavePayload {
    const value = this.model();
    const branchUuid = this.activeBranchUuid();

    return {
      // El `uuid` es lo único que convierte el alta en edición para el backend, y la versión viaja
      // con él: sin registro previo no hay nada que otro usuario pudiera haber cambiado.
      ...(this.ruleUuid ? { uuid: this.ruleUuid, version } : {}),
      name: value.name.trim(),
      ruleType: value.ruleType,
      roundingMode: value.roundingMode,
      roundingDirection: value.roundingDirection,
      priceLists: [
        ...(branchUuid
          ? value.priceLists
              .filter((row) => row.priceListUuid && row.percent !== null)
              .map((row) => ({
                priceList: { uuid: row.priceListUuid as string },
                branch: { uuid: branchUuid },
                percent: row.percent as number,
              }))
          : []),
        // Lo que la regla hace en otras sucursales viaja intacto: la colección se sincroniza con lo
        // que se envía, así que omitirlo lo daría de baja.
        ...this.otherBranchRows().map((row) => ({
          priceList: { uuid: row.priceList?.uuid as string },
          branch: { uuid: row.branch?.uuid as string },
          percent: row.percent as number,
        })),
      ],
      // Las tres colecciones viajan siempre, incluso vacías: omitirlas dejaría los vínculos
      // anteriores intactos y el formulario dejaría de ser la única fuente del alcance.
      products: value.productUuids.map((uuid) => ({ product: { uuid } })),
      categories: value.categoryUuids.map((uuid) => ({ category: { uuid } })),
    };
  }

  /**
   * Listas y categorías pueblan los selects. Cada catálogo falla por separado —un error deja ese
   * select vacío, no la pantalla—; el detalle de la regla es la excepción: en la edición no hay nada
   * que mostrar sin él, así que su error deja la pantalla en estado de error con reintento en vez de
   * abrir un formulario vacío que pisaría la regla al guardar.
   */
  private loadCatalogues(): void {
    this.loadState.set(LoadState.Loading);

    forkJoin({
      priceLists: this.priceRulesApi.getPriceLists().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('priceRules.toasts.priceListsError'));
          return of([] as PriceListOption[]);
        }),
      ),
      categories: this.priceRulesApi.getCategoryOptions().pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('priceRules.toasts.categoriesError'));
          return of([] as CategoryOption[]);
        }),
      ),
      rule: this.ruleUuid ? this.priceRulesApi.getByUuid(this.ruleUuid) : of(null),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.priceListOptions.set(data.priceLists);
          this.categoryOptions.set(data.categories);

          if (data.rule) {
            this.hydrate(data.rule);
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
   * Vuelca la regla guardada en el formulario, acotada a la sucursal activa: se editan sus filas y
   * las de las demás sucursales quedan aparte para reenviarse intactas.
   *
   * Los vínculos a productos y categorías llegan repetidos una vez por sucursal —así los persiste el
   * backend—, así que se deduplican antes de mostrarlos: la pantalla razona en términos de "qué
   * productos alcanza", no de vínculos.
   */
  private hydrate(rule: PriceRuleDto): void {
    this.ruleName.set(rule.name);
    // Corre también al recargar tras un conflicto, y ahí es lo que importa: la pantalla queda parada
    // sobre la versión que acaba de leer, así el siguiente guardado no vuelve a chocar por lo mismo.
    this.ruleVersion = rule.version;

    const products = linkedProductRefs(rule);
    const categories = linkedCategoryRefs(rule);
    const branchUuid = this.activeBranchUuid();
    const rows = priceListRows(rule);
    const ownRows = rows.filter((row) => row.branch?.uuid === branchUuid);

    this.otherBranchRows.set(rows.filter((row) => row.branch?.uuid !== branchUuid));

    // Una lista que se desactivó después de crear la regla ya no viene en el catálogo: sin reponerla
    // el select quedaría vacío y guardar desvincularía esa fila en silencio.
    this.priceListOptions.update((options) =>
      mergeMissingOptions(
        options,
        ownRows.map((row) => row.priceList),
      ),
    );

    this.productNames.set(new Map(products.map((product) => [product.uuid, product.name])));

    this.model.update((current) => ({
      ...current,
      name: rule.name ?? '',
      ruleType: rule.ruleType ?? DEFAULT_PRICE_RULE_TYPE,
      roundingMode: rule.roundingMode ?? DEFAULT_PRICE_ROUNDING_MODE,
      roundingDirection: rule.roundingDirection ?? DEFAULT_PRICE_ROUNDING_DIRECTION,
      priceLists: ownRows.map((row) => ({
        priceListUuid: row.priceList?.uuid ?? null,
        percent: row.percent ?? null,
      })),
      productUuids: products.map((product) => product.uuid),
      categoryUuids: categories.map((category) => category.uuid),
    }));
  }
}

function emptyRow(): PriceRuleListRowModel {
  return { priceListUuid: null, percent: null };
}

/** Agrega al catálogo las referencias que la regla usa y el catálogo ya no trae. */
function mergeMissingOptions(
  options: readonly UuidNameRef[],
  used: readonly (UuidNameRef | null | undefined)[],
): UuidNameRef[] {
  const known = new Set(options.map((option) => option.uuid));
  const missing = used.filter(
    (ref): ref is UuidNameRef => ref?.uuid !== undefined && !known.has(ref.uuid),
  );

  return [...options, ...missing];
}
