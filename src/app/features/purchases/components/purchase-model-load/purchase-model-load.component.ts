import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelect, MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { PickerProduct } from '../../../../core/product-picker/product-picker.model';
import { VariantPickerService } from '../../../../core/product-picker/variant-picker.service';
import {
  VariantAxisValue,
  axesOf,
  cellKey,
} from '../../../../core/product-picker/variant-selection';
import { PurchaseModelDto } from '../../data-access/purchase.model';
import { PurchasesCatalogApiService } from '../../data-access/purchases-catalog-api.service';
import {
  ModelLoadCell,
  ModelLoadLine,
  buildLoadGrid,
  columnTotal,
  gridTotal,
  linesOf,
  rowTotal,
} from './model-load-grid';

/** Cómo va la lista de modelos: en vuelo, lista, vedada por permiso, o caída. */
type ModelsState = 'loading' | 'ready' | 'forbidden' | 'error';

/**
 * Carga rápida por modelo en la compra (§5.6, wireframe `1p`).
 *
 * Es **otra forma de agregar líneas**, no una pantalla aparte: cuelga del encabezado de la tarjeta
 * de Líneas, donde ya está el buscador de productos. El modelo se elige **acá**, en un desplegable
 * —el remito del proveedor dice «Remera Básica», no una de sus doce variantes—, y la grilla
 * talle × color lo repone entero en una sola pasada. Al agregar, cada celda se convierte en una
 * línea normal de la grilla y desde ahí sigue el flujo de siempre —costo, lote, empaque—.
 *
 * Los totales por fila y por columna son el control cruzado contra ese remito, y por eso están los
 * dos.
 *
 * La pantalla lo abre con su propio `Injector`: los modelos salen de `PurchasesCatalogApiService`,
 * que provee la pantalla y no la raíz. Las variantes, en cambio, las pide `VariantPickerService`
 * —el mismo que usa el POS— acotadas a la sucursal activa.
 */
@Component({
  selector: 'app-purchase-model-load',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    TranslatePipe,
  ],
  templateUrl: './purchase-model-load.component.html',
  styleUrl: './purchase-model-load.component.css',
})
export class PurchaseModelLoadComponent {
  private readonly dialogRef = inject(MatDialogRef<PurchaseModelLoadComponent, ModelLoadLine[]>);
  private readonly catalogApi = inject(PurchasesCatalogApiService);
  private readonly variantPicker = inject(VariantPickerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly modelSelect = viewChild(MatSelect);

  protected readonly models = signal<readonly PurchaseModelDto[]>([]);
  protected readonly modelsState = signal<ModelsState>('loading');

  /** El modelo elegido en el desplegable; `null` mientras no se eligió ninguno. */
  protected readonly selectedModelUuid = signal<string | null>(null);

  /** Las variantes del modelo elegido en la sucursal activa, ya con su combinación de ejes. */
  private readonly variants = signal<readonly PickerProduct[]>([]);
  protected readonly loadingVariants = signal(false);
  protected readonly variantsFailed = signal(false);

  protected readonly axes = computed(() => axesOf(this.variants()));
  protected readonly rows = computed<VariantAxisValue[]>(() => [...(this.axes()[0]?.values ?? [])]);
  protected readonly columns = computed<VariantAxisValue[]>(() => [
    ...(this.axes()[1]?.values ?? []),
  ]);

  /** «Talle \ Color»: el rincón de la grilla nombra los dos ejes; con uno solo, ése. */
  protected readonly cornerLabel = computed(() => {
    const [rowAxis, columnAxis] = this.axes();
    const rowName = rowAxis?.name ?? '';
    return columnAxis ? `${rowName} \\ ${columnAxis.name}` : rowName;
  });

  protected readonly cells = signal<Map<string, ModelLoadCell>>(new Map());

  protected readonly lines = computed(() => linesOf(this.cells()));
  protected readonly total = computed(() => gridTotal(this.cells()));

  constructor() {
    this.loadModels();
  }

  protected loadModels(): void {
    this.modelsState.set('loading');

    this.catalogApi
      .getModels()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (models) => {
          this.models.set(models);
          this.modelsState.set('ready');
          this.focusModelSelect();
        },
        error: (error: unknown) => {
          // Sin `productmodel.view` el backend responde 403: no es que falló, es que no se puede,
          // y las dos cosas se dicen distinto.
          this.modelsState.set(
            error instanceof HttpErrorResponse && error.status === 403 ? 'forbidden' : 'error',
          );
        },
      });
  }

  /**
   * Deja el foco en el desplegable, que es lo primero que se toca. Recién cuando la lista llegó:
   * mientras carga el campo está apagado y el foco inicial del diálogo cae en «Cancelar», así que
   * hay que moverlo a mano, y después del render que lo habilita.
   */
  private focusModelSelect(): void {
    afterNextRender(() => this.modelSelect()?.focus(), { injector: this.injector });
  }

  /**
   * Cambiar de modelo tira la grilla anterior: las cantidades eran de aquel modelo, y arrastrarlas
   * cargaría los talles de una remera en otra.
   */
  protected onModelChange(modelUuid: string | null): void {
    this.selectedModelUuid.set(modelUuid);
    this.variants.set([]);
    this.cells.set(new Map());
    this.variantsFailed.set(false);

    if (!modelUuid) {
      this.loadingVariants.set(false);
      return;
    }

    this.loadingVariants.set(true);

    this.variantPicker
      .variantsOf(modelUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (variants) => {
          // Pudo cambiar de modelo mientras la respuesta viajaba: la de otro armaría la grilla
          // equivocada bajo el nombre elegido.
          if (this.selectedModelUuid() !== modelUuid) {
            return;
          }
          this.loadingVariants.set(false);
          this.variants.set(variants);
          this.cells.set(buildLoadGrid(variants, axesOf(variants)));
        },
        error: () => {
          if (this.selectedModelUuid() !== modelUuid) {
            return;
          }
          this.loadingVariants.set(false);
          this.variantsFailed.set(true);
        },
      });
  }

  protected cellOf(row: VariantAxisValue, column: VariantAxisValue | undefined): ModelLoadCell | undefined {
    return this.cells().get(cellKey(row.uuid, column?.uuid ?? ''));
  }

  protected onQuantityChange(
    row: VariantAxisValue,
    column: VariantAxisValue | undefined,
    quantity: number | null,
  ): void {
    const key = cellKey(row.uuid, column?.uuid ?? '');
    this.cells.update((cells) => {
      const next = new Map(cells);
      const cell = next.get(key);
      if (cell) {
        next.set(key, { ...cell, quantity });
      }
      return next;
    });
  }

  protected rowTotalOf(row: VariantAxisValue): number {
    return rowTotal(
      this.cells(),
      row.uuid,
      this.columns().length > 0 ? this.columns().map((column) => column.uuid) : [''],
    );
  }

  protected columnTotalOf(column: VariantAxisValue): number {
    return columnTotal(
      this.cells(),
      column.uuid,
      this.rows().map((row) => row.uuid),
    );
  }

  protected onAdd(): void {
    this.dialogRef.close(this.lines());
  }

  protected onClose(): void {
    this.dialogRef.close();
  }
}
