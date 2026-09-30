import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, of, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  PickerProduct,
  isAssembledKitPick,
} from '../../../../core/product-picker/product-picker.model';
import { ProductPickerService } from '../../../../core/product-picker/product-picker.service';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import { WarehousesApiService } from '../../../../core/warehouse/warehouses-api.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ASSEMBLIES_PATH, NEW_ASSEMBLY_PATH } from '../../assemblies.paths';
import {
  ASSEMBLY_CREATE_PERMISSION,
  AssemblyComponentPayload,
  AssemblyPayload,
  AssemblyPreview,
} from '../../data-access/assembly.model';
import { AssembliesApiService } from '../../data-access/assemblies-api.service';

/**
 * «Nuevo armado» (wireframe `1s`): consume los componentes e ingresa el terminado, en una sola
 * operación.
 *
 * **Dos columnas que son las dos mitades de la operación** —se produce a la izquierda, se consume a
 * la derecha— y todo en una pantalla, porque es un commit atómico (RN-23). No hay un paso que
 * persista la mitad.
 *
 * Lo que la hace útil es el precálculo en vivo contra `/assembly/preview`: cuánto se puede armar y
 * **qué componente lo limita**, el reparto por lote, el costo que se va a congelar y el vencimiento
 * sugerido. El costo unitario se muestra **como cuenta** —costo ÷ cantidad— y no como resultado: es
 * lo que queda congelado en el lote del terminado (RN-24), y un número que nadie puede rehacer es un
 * número que nadie revisa.
 */
@Component({
  selector: 'app-assembly-form-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
  ],
  providers: [AssembliesApiService],
  templateUrl: './assembly-form.page.html',
  styleUrl: './assembly-form.page.css',
})
export class AssemblyFormPage implements OnInit {
  private readonly api = inject(AssembliesApiService);
  private readonly warehousesApi = inject(WarehousesApiService);
  private readonly productPicker = inject(ProductPickerService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly canCreate = this.auth.hasPermission(ASSEMBLY_CREATE_PERMISSION);

  // ── Qué se produce ───────────────────────────────────────────────────
  protected readonly product = signal<PickerProduct | null>(null);
  protected readonly quantity = signal<number | null>(1);
  protected readonly warehouses = signal<readonly WarehouseDto[]>([]);
  protected readonly warehouseUuid = signal<string | null>(null);

  // ── El lote del terminado ────────────────────────────────────────────
  protected readonly batchNumber = signal('');
  protected readonly expirationDate = signal('');
  protected readonly serials = signal('');

  // ── Lo que se consume ────────────────────────────────────────────────
  protected readonly extraCost = signal<number | null>(null);
  /** Cantidades ajustadas para **este** armado. No tocan la composición del producto (P10). */
  private readonly overrides = signal<ReadonlyMap<string, number>>(new Map());

  protected readonly preview = signal<AssemblyPreview | null>(null);
  protected readonly previewing = signal(false);
  protected readonly saving = signal(false);

  /** El eje del terminado decide qué pide el formulario: partida, series, o nada. */
  protected readonly needsBatch = computed(() => {
    const tracking = this.preview()?.productStockTracking ?? this.product()?.stockTracking ?? null;
    return tracking === 'BATCH' || (tracking === 'SERIAL' && this.expirationRequired());
  });

  protected readonly needsSerials = computed(
    () => (this.preview()?.productStockTracking ?? this.product()?.stockTracking) === 'SERIAL',
  );

  /** Cuántas series hay que informar todavía: la cuenta que evita el `SERIAL_COUNT_MISMATCH`. */
  protected readonly serialCount = computed(
    () => this.serials().split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).length,
  );

  protected readonly serialsMismatch = computed(
    () => this.needsSerials() && this.serialCount() !== Math.trunc(this.quantity() ?? 0),
  );

  /**
   * El vencimiento efectivo: el que se escribió, o el sugerido si nadie tocó nada.
   *
   * **Se puede bajar, no subir** (RN-25). El backend lo rechaza igual; acá se avisa antes para que
   * el operador no descubra el techo recién al confirmar.
   */
  protected readonly expirationExceeded = computed(() => {
    const suggested = this.preview()?.suggestedExpirationDate;
    const chosen = this.expirationDate();
    return Boolean(suggested && chosen && chosen > suggested);
  });

  protected readonly canSubmit = computed(
    () =>
      this.canCreate &&
      !this.saving() &&
      this.product() !== null &&
      this.warehouseUuid() !== null &&
      (this.quantity() ?? 0) > 0 &&
      (!this.needsBatch() || this.batchNumber().trim().length > 0) &&
      !this.serialsMismatch() &&
      !this.expirationExceeded(),
  );

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.assemblies', link: ASSEMBLIES_PATH },
      { labelKey: 'assemblies.form.title', link: NEW_ASSEMBLY_PATH },
    ]);

    // El precálculo se dispara con cada cambio de lo que lo afecta, con un respiro: el operador
    // teclea la cantidad dígito a dígito y una llamada por tecla no le diría nada más.
    toObservable(
      computed(() => ({
        productUuid: this.product()?.uuid ?? null,
        warehouseUuid: this.warehouseUuid(),
        quantity: this.quantity(),
        extraCost: this.extraCost(),
        overrides: this.overrides(),
      })),
    )
      .pipe(
        debounceTime(300),
        switchMap((state) => {
          if (!state.productUuid || !state.warehouseUuid || (state.quantity ?? 0) <= 0) {
            this.preview.set(null);
            return of(null);
          }
          this.previewing.set(true);
          return this.api.preview({
            product: { uuid: state.productUuid },
            warehouse: { uuid: state.warehouseUuid },
            quantity: state.quantity as number,
            extraCost: state.extraCost,
            components: this.componentOverrides(),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (preview) => {
          this.previewing.set(false);
          if (preview) {
            this.preview.set(preview);
            this.adoptSuggestedExpiration(preview);
          }
        },
        error: (error: unknown) => {
          this.previewing.set(false);
          this.preview.set(null);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('assemblies.form.previewError')),
          );
        },
      });
  }

  ngOnInit(): void {
    this.loadWarehouses();
  }

  /**
   * El selector se abre acotado a los kits armados: es lo único que se puede armar
   * (`ASSEMBLY_PRODUCT_NOT_ASSEMBLABLE`), y ofrecer el catálogo entero sería ofrecer un error.
   */
  protected onPickProduct(): void {
    this.productPicker
      .pick({
        availability: 'any',
        title: this.translate.instant('assemblies.form.pickerTitle'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((picked) => {
        if (!picked) {
          return;
        }
        // El modo, no el tipo: un kit **virtual** no se arma —no tiene dónde dejar el terminado— y
        // el backend lo rechaza con `ASSEMBLY_PRODUCT_NOT_ASSEMBLABLE`. Se dice acá, que es donde el
        // operador todavía tiene el selector abierto para elegir otro.
        if (!isAssembledKitPick(picked)) {
          this.toast.error(this.translate.instant('assemblies.form.notAssemblable'));
          return;
        }
        this.product.set(picked);
        this.overrides.set(new Map());
        this.batchNumber.set('');
        this.expirationDate.set('');
        this.serials.set('');
      });
  }

  protected onWarehouseChange(uuid: string): void {
    this.warehouseUuid.set(uuid);
  }

  /**
   * Ajusta lo que se consume de un componente **para este armado**.
   *
   * No toca la composición del producto (P10): «hoy usé un poco más de queso» y «de ahora en más
   * lleva más queso» son dos decisiones distintas, y la segunda se toma en la ficha. Lo que se
   * registra acá es lo que efectivamente pasó.
   */
  protected onComponentQuantityChange(componentUuid: string, raw: string): void {
    const value = Number(raw);
    this.overrides.update((current) => {
      const next = new Map(current);
      if (!Number.isFinite(value) || value <= 0) {
        next.delete(componentUuid);
      } else {
        next.set(componentUuid, value);
      }
      return next;
    });
  }

  protected onSubmit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const product = this.product();
    const warehouseUuid = this.warehouseUuid();
    if (!product || !warehouseUuid) {
      return;
    }

    const payload: AssemblyPayload = {
      product: { uuid: product.uuid },
      warehouse: { uuid: warehouseUuid },
      quantity: this.quantity() as number,
      extraCost: this.extraCost(),
      batchNumber: this.needsBatch() ? this.batchNumber().trim() : null,
      expirationDate: this.expirationDate() || null,
      serials: this.needsSerials() ? this.serialList() : null,
      components: this.componentOverrides(),
    };

    this.saving.set(true);
    this.api
      .assemble(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (assembly) => {
          this.saving.set(false);
          this.toast.success(
            this.translate.instant('assemblies.form.success', {
              assembly: assembly.publicId ?? '',
            }),
          );
          void this.router.navigate([ASSEMBLIES_PATH]);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('assemblies.form.error')),
          );
        },
      });
  }

  protected onCancel(): void {
    void this.router.navigate([ASSEMBLIES_PATH]);
  }

  /** Cuánto se va a consumir de un componente, con el ajuste del operador si lo hubo. */
  protected quantityOf(componentUuid: string, fallback: number | null): number {
    return this.overrides().get(componentUuid) ?? fallback ?? 0;
  }

  private componentOverrides(): AssemblyComponentPayload[] | null {
    const entries = [...this.overrides().entries()];
    if (entries.length === 0) {
      return null;
    }
    return entries.map(([uuid, quantity]) => ({ component: { uuid }, quantity }));
  }

  private serialList(): string[] {
    return this.serials()
      .split(/[\n,;]+/)
      .map((serial) => serial.trim())
      .filter(Boolean);
  }

  /**
   * Con el vencimiento vacío se adopta el sugerido: es el que el backend va a usar igual, y verlo
   * escrito es lo que hace entendible que se pueda **bajar** y no subir.
   */
  private adoptSuggestedExpiration(preview: AssemblyPreview): void {
    if (!this.expirationDate() && preview.suggestedExpirationDate) {
      this.expirationDate.set(preview.suggestedExpirationDate);
    }
  }

  /** Un `SERIAL` con partida existe (P9): el electrodoméstico con lote y número de serie. */
  private expirationRequired(): boolean {
    return this.preview()?.suggestedExpirationDate !== null;
  }

  private loadWarehouses(): void {
    this.warehousesApi
      .listAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (warehouses) => {
          this.warehouses.set(warehouses);
          if (!this.warehouseUuid() && warehouses.length > 0) {
            this.warehouseUuid.set(warehouses[0].uuid);
          }
          // El producto que llega desde la ficha se resuelve DESPUÉS de tener depósito: el
          // precálculo con el que se lo resuelve necesita uno, y sin él la pantalla abriría con el
          // selector vacío pese a haber entrado desde un producto concreto.
          const productUuid = this.route.snapshot.queryParamMap.get('product');
          if (productUuid && this.warehouseUuid()) {
            this.preselectProduct(productUuid);
          }
        },
        error: () =>
          this.toast.error(this.translate.instant('assemblies.form.warehousesError')),
      });
  }

  /**
   * El producto que llega por `?product=` desde la ficha (wireframe `1r`).
   *
   * Se resuelve contra el precálculo y no contra el catálogo: `/assembly/preview` ya devuelve el
   * nombre del producto y valida que sea armable, así que una llamada alcanza para las dos cosas y
   * un producto que no se puede armar avisa acá y no al confirmar.
   */
  private preselectProduct(uuid: string): void {
    this.api
      .preview({
        product: { uuid },
        warehouse: { uuid: this.warehouseUuid() as string },
        quantity: 1,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          // El precálculo ya respondió, así que es un armado: se declara el modo en vez de dejarlo
          // implícito, que es lo que hacía que cualquier lector lo tomara por un kit virtual.
          this.product.set({
            uuid,
            name: preview.product.name,
            type: 'KIT',
            kitMode: 'ASSEMBLE',
            stockTracking: preview.productStockTracking,
          } as PickerProduct);
        },
        error: () => this.toast.error(this.translate.instant('assemblies.form.preselectError')),
      });
  }
}
