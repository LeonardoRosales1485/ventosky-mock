import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { UuidNameRef } from '../../../../core/http/api-refs';
import { API_ERROR_CODES, hasApiErrorCode } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { HasUnsavedChanges } from '../../../../core/unsaved-changes/unsaved-changes.tracker';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  PRODUCT_BRANCH_ASSIGN_PERMISSION,
  ProductModelAxisOption,
  ProductModelCategoryOption,
  ProductModelDto,
  ProductModelOptionValue,
  ProductModelPriceList,
  ProductModelVariantDto,
} from '../../data-access/product-model.model';
import { ProductModelsApiService } from '../../data-access/product-models-api.service';
import { PRODUCTS_PATH, variantProductPath } from '../../product-models.paths';
import { MatrixRow, buildMatrix } from '../../components/variant-matrix/variant-matrix';

/** Un eje elegido para el modelo, con qué valores de él usa. */
interface SelectedAxis {
  axis: ProductModelAxisOption;
  /** Los uuid de los valores tildados, en el orden del catálogo. */
  selectedValueUuids: string[];
}

/**
 * Alta y edición de un modelo con su matriz de variantes (§5.4, §13.2, wireframe `1h`).
 *
 * **Una sola pantalla, no un asistente**: los tres pasos —datos comunes, ejes, matriz— se ven a la
 * vez y la grilla se recalcula al tocar un valor. Partirlo en pasos escondería justo lo que el
 * usuario necesita comparar: cuántas variantes le va a costar cada valor que agrega.
 *
 * **Agregar un talle después es agregar variantes, no rehacer el modelo**: al reabrir, las
 * combinaciones que ya existen llegan con el uuid de su producto y la grilla las muestra bloqueadas
 * si ya se movieron.
 */
@Component({
  selector: 'app-product-model-form-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
  ],
  providers: [ProductModelsApiService],
  templateUrl: './product-model-form.page.html',
  styleUrl: './product-model-form.page.css',
})
export class ProductModelFormPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(ProductModelsApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly auth = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly modelUuid = signal<string | null>(null);
  private modelVersion: number | undefined;
  private readonly dirty = signal(false);

  /**
   * El guard de salida lee esto: es un `Signal`, no un método. Guardando no cuenta como sucio —el
   * router navega solo al terminar y preguntar ahí sería preguntar por algo que ya se guardó—.
   */
  readonly hasUnsavedChanges = computed(() => this.dirty() && !this.saving());

  /* Paso 1 — datos comunes. */
  protected readonly name = signal('');
  protected readonly skuPrefix = signal('');
  protected readonly brandUuid = signal<string | null>(null);
  protected readonly categoryUuid = signal<string | null>(null);
  protected readonly unitMeasure = signal<string>('UNIT');
  protected readonly taxRate = signal<number>(21);

  /**
   * Mandar `branches` sin `product.branch_assign` es un 403, igual que en el ABM de producto: sin
   * el permiso la grilla no se muestra y el campo se omite del payload. Las variantes nacen sin
   * sucursal —como antes de esta grilla— y otro usuario las publica desde la ficha.
   */
  protected readonly canAssignBranches = this.auth.hasPermission(PRODUCT_BRANCH_ASSIGN_PERMISSION);

  protected readonly branches = signal<readonly BranchDto[]>([]);
  protected readonly branchUuids = signal<readonly string[]>([]);

  /* Paso 2 — en qué se diferencian. */
  protected readonly availableAxes = signal<readonly ProductModelAxisOption[]>([]);
  protected readonly selectedAxes = signal<SelectedAxis[]>([]);

  /* Paso 3 — la matriz. */
  protected readonly rows = signal<MatrixRow[]>([]);

  protected readonly brands = signal<readonly UuidNameRef[]>([]);
  protected readonly categories = signal<readonly ProductModelCategoryOption[]>([]);
  protected readonly priceLists = signal<readonly ProductModelPriceList[]>([]);

  /** La lista contra la que la grilla edita el precio: la principal, o la primera que haya. */
  protected readonly priceListUuid = computed(
    () =>
      this.priceLists().find((list) => list.isPrincipal)?.uuid ?? this.priceLists()[0]?.uuid ?? null,
  );

  protected readonly isEdit = computed(() => this.modelUuid() !== null);
  protected readonly selectedCount = computed(() => this.rows().filter((row) => row.selected).length);

  /**
   * Las combinaciones tildadas que **todavía no son un producto**. En el alta son todas; reabriendo
   * un modelo son las que el usuario acaba de tildar.
   */
  protected readonly newVariantCount = computed(
    () => this.rows().filter((row) => row.selected && !row.uuid).length,
  );

  /**
   * Qué promete el botón de guardar. En el alta el número es la información útil —«Crear 16
   * variantes» dice exactamente cuántos productos van a nacer—, pero reabriendo un modelo esa misma
   * frase miente: el guardado actualiza lo que ya existe y crea, como mucho, las filas nuevas.
   * Prometer dieciséis altas sobre dieciséis variantes que ya están es lo que hace dudar de apretar.
   */
  protected readonly saveLabelKey = computed(() => {
    if (!this.isEdit()) {
      return 'productModels.form.save';
    }
    return this.newVariantCount() > 0
      ? 'productModels.form.saveWithNew'
      : 'productModels.form.saveChanges';
  });

  /** Los ejes que todavía no están en el modelo: los que ofrece «Agregar eje». */
  protected readonly addableAxes = computed(() => {
    const used = new Set(this.selectedAxes().map((selected) => selected.axis.uuid));
    return this.availableAxes().filter((axis) => !used.has(axis.uuid));
  });

  protected readonly unitMeasures = ['UNIT', 'KILOGRAM', 'GRAM', 'LITER', 'MILLILITER', 'METER'];

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.products', link: PRODUCTS_PATH },
      {
        labelKey: this.isEdit() ? 'productModels.form.editTitle' : 'productModels.form.createTitle',
      },
    ]);
  }

  ngOnInit(): void {
    const uuid = this.route.snapshot.paramMap.get('uuid');
    this.modelUuid.set(uuid);
    this.loadOptions(uuid);
  }

  private loadOptions(uuid: string | null): void {
    forkJoin({
      axes: this.api.getAxes().pipe(catchError(() => of([] as ProductModelAxisOption[]))),
      brands: this.api.getBrands().pipe(catchError(() => of([] as UuidNameRef[]))),
      categories: this.api
        .getCategoryOptions()
        .pipe(catchError(() => of([] as ProductModelCategoryOption[]))),
      priceLists: this.api.getPriceLists().pipe(catchError(() => of([] as ProductModelPriceList[]))),
      branches: this.canAssignBranches
        ? this.branchesApi.listAll().pipe(
            catchError(() => {
              this.toast.error(this.translate.instant('productModels.toasts.branchesError'));
              return of([] as BranchDto[]);
            }),
          )
        : of([] as BranchDto[]),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((data) => {
        this.availableAxes.set(data.axes);
        this.brands.set(data.brands);
        this.categories.set(data.categories);
        this.priceLists.set(data.priceLists);
        this.branches.set(data.branches.filter((branch) => branch.active !== false));
        if (uuid) {
          this.loadModel(uuid);
        } else {
          // Un modelo nuevo se ofrece en toda la empresa salvo que se diga lo contrario: destildar
          // las pocas sucursales que no lo venden es menos trabajo que tildar todas. Lo que quede
          // acá es con lo que nacen las N variantes de la matriz.
          this.branchUuids.set(this.branches().map((branch) => branch.uuid));
          this.loading.set(false);
        }
      });
  }

  private loadModel(uuid: string): void {
    this.api
      .getByUuid(uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (model) => {
          this.hydrate(model);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error(this.translate.instant('productModels.toasts.loadError'));
          void this.router.navigate([PRODUCTS_PATH]);
        },
      });
  }

  private hydrate(model: ProductModelDto): void {
    this.modelVersion = model.version;
    this.name.set(model.name);
    this.skuPrefix.set(model.skuPrefix ?? '');
    this.brandUuid.set(model.brand?.uuid ?? null);
    this.categoryUuid.set(model.category?.uuid ?? null);
    this.unitMeasure.set(model.unitMeasure ?? 'UNIT');
    this.taxRate.set(model.taxRate ?? 21);
    this.selectedAxes.set(
      (model.options ?? []).map((option) => ({
        axis: {
          uuid: option.option.uuid,
          name: option.option.name,
          values: option.values,
        },
        selectedValueUuids: (option.values ?? [])
          .map((value) => value.uuid)
          .filter((value): value is string => !!value),
      })),
    );
    // Las sucursales del modelo son las de sus variantes: se tildan las que ya lo ofrecen, y lo que
    // el usuario cambie acá vale para las filas nuevas —las que ya existen se editan en su ficha—.
    const visible = new Set(this.branches().map((branch) => branch.uuid));
    this.branchUuids.set(
      (model.branches ?? []).map((branch) => branch.uuid).filter((uuid) => visible.has(uuid)),
    );
    this.rebuildMatrix(model.variants ?? []);
    this.dirty.set(false);
  }

  /* ── Sucursales donde se ofrece ───────────────────────────────────────── */

  protected readonly allBranchesSelected = computed(() => {
    const available = this.branches();
    return available.length > 0 && available.length === this.branchUuids().length;
  });

  protected readonly someBranchesSelected = computed(() => {
    const selected = this.branchUuids().length;
    return selected > 0 && selected < this.branches().length;
  });

  protected isBranchSelected(branchUuid: string): boolean {
    return this.branchUuids().includes(branchUuid);
  }

  protected onBranchToggle(branchUuid: string, checked: boolean): void {
    this.branchUuids.update((selected) =>
      checked ? [...selected, branchUuid] : selected.filter((uuid) => uuid !== branchUuid),
    );
    this.dirty.set(true);
  }

  protected onToggleAllBranches(checked: boolean): void {
    this.branchUuids.set(checked ? this.branches().map((branch) => branch.uuid) : []);
    this.dirty.set(true);
  }

  /* ── Paso 2: ejes y valores ───────────────────────────────────────────── */

  /**
   * Al agregar un eje se piden sus valores: el listado no los trae, y sin ellos no habría chips que
   * tildar. Se agrega con **todos** tildados, que es el caso normal —un modelo suele venir en todos
   * los colores del catálogo— y destildar es más rápido que tildar de a uno.
   */
  protected onAddAxis(axisUuid: string): void {
    const axis = this.availableAxes().find((candidate) => candidate.uuid === axisUuid);
    if (!axis) {
      return;
    }
    this.api
      .getAxis(axisUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (loaded) => {
          const values = loaded.values ?? [];
          this.selectedAxes.update((axes) => [
            ...axes,
            {
              axis: { ...axis, values },
              selectedValueUuids: values.map((value) => value.uuid),
            },
          ]);
          this.rebuildMatrix(this.currentVariants());
          this.dirty.set(true);
        },
        error: () => this.toast.error(this.translate.instant('productModels.toasts.axesError')),
      });
  }

  protected onRemoveAxis(axisUuid: string): void {
    this.selectedAxes.update((axes) => axes.filter((selected) => selected.axis.uuid !== axisUuid));
    this.rebuildMatrix(this.currentVariants());
    this.dirty.set(true);
  }

  protected isValueSelected(axisUuid: string, valueUuid: string): boolean {
    const axis = this.selectedAxes().find((selected) => selected.axis.uuid === axisUuid);
    return axis?.selectedValueUuids.includes(valueUuid) ?? false;
  }

  /** Tocar un valor recalcula la grilla al instante: es la promesa de la pantalla única. */
  protected onToggleValue(axisUuid: string, valueUuid: string): void {
    this.selectedAxes.update((axes) =>
      axes.map((selected) => {
        if (selected.axis.uuid !== axisUuid) {
          return selected;
        }
        const has = selected.selectedValueUuids.includes(valueUuid);
        const next = has
          ? selected.selectedValueUuids.filter((uuid) => uuid !== valueUuid)
          : orderedValueUuids(selected, valueUuid);
        return { ...selected, selectedValueUuids: next };
      }),
    );
    this.rebuildMatrix(this.currentVariants());
    this.dirty.set(true);
  }

  /* ── Paso 3: la matriz ────────────────────────────────────────────────── */

  /**
   * Recalcula el producto cartesiano conservando lo que ya estaba cargado —SKU, precio, y el uuid de
   * la variante que ya existe—. Es lo que hace que agregar un talle no borre las once filas que el
   * usuario ya completó.
   */
  private rebuildMatrix(existing: readonly ProductModelVariantDto[]): void {
    this.rows.set(
      buildMatrix(
        this.selectedAxes().map((selected) => ({
          axisUuid: selected.axis.uuid,
          axisName: selected.axis.name,
          values: (selected.axis.values ?? []).filter((value) =>
            selected.selectedValueUuids.includes(value.uuid),
          ),
        })),
        existing,
        this.priceListUuid(),
      ),
    );
  }

  /** Las filas de hoy como variantes, para que el recálculo no pierda lo cargado. */
  private currentVariants(): ProductModelVariantDto[] {
    return this.rows().map((row) => ({
      uuid: row.uuid,
      version: row.version,
      selected: row.selected,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      hasMovements: row.hasMovements,
      totalStock: row.totalStock,
      optionValues: row.values.map((value) => ({ optionValueUuid: value.uuid })),
      priceListEntries: this.priceListUuid()
        ? [{ priceListUuid: this.priceListUuid()!, price: row.price }]
        : [],
    }));
  }

  protected onToggleRow(index: number): void {
    this.rows.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, selected: !row.selected } : row)),
    );
    this.dirty.set(true);
  }

  protected onRowFieldChange(index: number, field: 'sku' | 'barcode', value: string): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    this.dirty.set(true);
  }

  protected onRowPriceChange(index: number, value: number | null): void {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, price: value } : row)));
    this.dirty.set(true);
  }

  /* ── Carga masiva por columna ─────────────────────────────────────────── */

  /**
   * «Tildar todas» y sus dos hermanas son la operación real de la pantalla: el mismo precio para
   * doce filas se carga una vez, no doce. Sin esto la matriz sería más lenta que cargar los
   * productos sueltos, que es justo lo que vino a evitar.
   */
  protected onSelectAll(selected: boolean): void {
    this.rows.update((rows) =>
      rows.map((row) => (row.hasMovements ? row : { ...row, selected })),
    );
    this.dirty.set(true);
  }

  /** Rellena el SKU sugerido en las filas que no lo tienen escrito a mano. */
  protected onAutoSku(): void {
    const prefix = this.skuPrefix().trim();
    if (!prefix) {
      this.toast.error(this.translate.instant('productModels.toasts.skuPrefixRequired'));
      return;
    }
    this.rows.update((rows) =>
      rows.map((row) =>
        row.hasMovements
          ? row
          : { ...row, sku: `${prefix}-${row.values.map(suffixOf).join('-')}` },
      ),
    );
    this.dirty.set(true);
  }

  /**
   * Aplica el precio de la primera fila con precio a todas las demás. Es **comodidad de carga, no un
   * vínculo** (RN-19): después de aplicarlo cada precio es independiente y editar uno no arrastra al
   * resto, que es lo que hace posible que el talle especial valga más.
   */
  protected onSamePriceForAll(): void {
    const reference = this.rows().find((row) => row.price != null)?.price ?? null;
    if (reference == null) {
      this.toast.error(this.translate.instant('productModels.toasts.priceReferenceMissing'));
      return;
    }
    this.rows.update((rows) => rows.map((row) => ({ ...row, price: reference })));
    this.dirty.set(true);
  }

  /* ── Guardado ─────────────────────────────────────────────────────────── */

  protected onSave(): void {
    const name = this.name().trim();
    if (!name) {
      this.toast.error(this.translate.instant('productModels.toasts.nameRequired'));
      return;
    }
    if (this.selectedAxes().length === 0) {
      this.toast.error(this.translate.instant('productModels.toasts.axesRequired'));
      return;
    }
    this.saving.set(true);
    this.api
      .save({
        uuid: this.modelUuid() ?? undefined,
        version: this.modelVersion,
        name,
        skuPrefix: this.skuPrefix().trim() || null,
        brand: this.brandUuid() ? { uuid: this.brandUuid()! } : null,
        category: this.categoryUuid() ? { uuid: this.categoryUuid()! } : null,
        unitMeasure: this.unitMeasure(),
        taxRate: this.taxRate(),
        options: this.selectedAxes().map((selected) => ({
          option: { uuid: selected.axis.uuid, name: selected.axis.name },
          values: (selected.axis.values ?? []).filter((value) =>
            selected.selectedValueUuids.includes(value.uuid),
          ),
        })),
        // Sin el permiso el campo se omite: mandarlo es un 403, y la grilla ni siquiera se mostró.
        branches: this.canAssignBranches ? this.branchUuids().map((uuid) => ({ uuid })) : undefined,
        variants: this.currentVariants(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.dirty.set(false);
          this.toast.success(
            this.translate.instant('productModels.toasts.saved', {
              count: saved.variantsCount ?? 0,
            }),
          );
          void this.router.navigate([PRODUCTS_PATH]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(this.saveErrorMessage(error));
        },
      });
  }

  private saveErrorMessage(error: unknown): string {
    if (hasApiErrorCode(error, API_ERROR_CODES.PRODUCT_VARIANT_COMBINATION_DUPLICATED)) {
      return this.translate.instant('productModels.toasts.combinationDuplicated');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.VARIANT_INCOMPLETE)) {
      return this.translate.instant('productModels.toasts.variantIncomplete');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.MODEL_OPTION_REQUIRES_VALUES)) {
      return this.translate.instant('productModels.toasts.axisWithoutValues');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.MODEL_REQUIRES_OPTIONS)) {
      return this.translate.instant('productModels.toasts.axesRequired');
    }
    return this.translate.instant('productModels.toasts.saveError');
  }

  /**
   * Abre la ficha completa de la variante. La matriz es para el alta rápida: los códigos de barras,
   * los empaques, los lotes y los precios por lista siguen viviendo en la pantalla del producto,
   * porque una variante es un producto (RN-11).
   *
   * Se abre en una pestaña nueva a propósito: irse de la matriz con la grilla a medio completar
   * costaría todo lo cargado.
   */
  protected onOpenVariant(uuid: string | undefined): void {
    if (uuid) {
      window.open(variantProductPath(uuid), '_blank', 'noopener');
    }
  }

  protected onCancel(): void {
    void this.router.navigate([PRODUCTS_PATH]);
  }
}

/** Reinserta el valor respetando el orden del catálogo, que es el que el usuario definió. */
function orderedValueUuids(selected: SelectedAxis, valueUuid: string): string[] {
  const next = [...selected.selectedValueUuids, valueUuid];
  return (selected.axis.values ?? [])
    .map((value) => value.uuid)
    .filter((uuid) => next.includes(uuid));
}

/** El sufijo del SKU: el `code` del valor, o el valor cuando no tiene. */
function suffixOf(value: ProductModelOptionValue): string {
  return value.code?.trim() || value.value;
}
