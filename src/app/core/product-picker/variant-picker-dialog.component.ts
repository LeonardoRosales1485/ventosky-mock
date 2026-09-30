import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { PickerProduct } from './product-picker.model';
import {
  VariantAxisValue,
  axesOf,
  cellKey,
  combinationLabel,
  stockGrid,
  variantFor,
} from './variant-selection';

/** Lo que el selector de variante necesita para abrirse. */
export interface VariantPickerDialogData {
  modelName: string;
  /** Las variantes del modelo, ya con su stock y sus precios en la sucursal activa. */
  variants: readonly PickerProduct[];
}

/**
 * Selector de variante al elegir un modelo (§5.6, §13.6, wireframe `1l`).
 *
 * **El escaneo no pasa por acá.** Un código de barras resuelve la variante directo y la agrega sin
 * abrir nada: el mostrador no puede perder velocidad porque el catálogo ahora tenga modelos. Este
 * diálogo es para cuando el operador busca por nombre, que es cuando de verdad tiene que elegir.
 *
 * Chips por eje **y** grilla de stock, no una cosa o la otra: los chips son para elegir y la grilla
 * es para decidir —de un vistazo se ve si conviene ofrecer otro color en vez de perder la venta—.
 */
@Component({
  selector: 'app-variant-picker-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
  ],
  templateUrl: './variant-picker-dialog.component.html',
  styleUrl: './variant-picker-dialog.component.css',
})
export class VariantPickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<VariantPickerDialogComponent, PickerProduct>);
  protected readonly data = inject<VariantPickerDialogData>(MAT_DIALOG_DATA);

  protected readonly axes = computed(() => axesOf(this.data.variants));

  /** Qué valor eligió el operador en cada eje. */
  private readonly selection = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly selected = computed(() => variantFor(this.data.variants, this.selection()));

  protected readonly grid = computed(() =>
    stockGrid(this.data.variants, this.axes(), this.selection()),
  );

  protected readonly selectedLabel = computed(() => {
    const variant = this.selected();
    return variant ? combinationLabel(variant) : '';
  });

  protected isChosen(axisUuid: string, valueUuid: string): boolean {
    return this.selection().get(axisUuid) === valueUuid;
  }

  /**
   * Una combinación que el modelo no fabrica se muestra apagada, no escondida: esconderla dejaría
   * al operador buscando un talle que nunca va a aparecer.
   */
  protected isAvailable(axisUuid: string, valueUuid: string): boolean {
    return this.data.variants.some((variant) =>
      (variant.variantValues ?? []).some(
        (value) => value.optionUuid === axisUuid && value.optionValueUuid === valueUuid,
      ),
    );
  }

  protected onChoose(axisUuid: string, valueUuid: string): void {
    this.selection.update((current) => {
      const next = new Map(current);
      if (next.get(axisUuid) === valueUuid) {
        next.delete(axisUuid);
      } else {
        next.set(axisUuid, valueUuid);
      }
      return next;
    });
  }

  protected stockOf(row: VariantAxisValue, column: VariantAxisValue | undefined): number | null {
    const value = this.grid().stock.get(cellKey(row.uuid, column?.uuid ?? ''));
    return value ?? null;
  }

  /** `true` cuando esa celda es la combinación elegida: la grilla la resalta. */
  protected isCurrentCell(row: VariantAxisValue, column: VariantAxisValue | undefined): boolean {
    const axes = this.axes();
    const selection = this.selection();
    return (
      selection.get(axes[0]?.uuid ?? '') === row.uuid &&
      (!column || selection.get(axes[1]?.uuid ?? '') === column.uuid)
    );
  }

  protected onAdd(): void {
    const variant = this.selected();
    if (variant) {
      this.dialogRef.close(variant);
    }
  }

  protected onClose(): void {
    this.dialogRef.close();
  }
}
