import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  minQuantity,
  quantityDecimalsOf,
  quantityStep,
} from '../../../../core/product/quantity-precision';
import { SaleCartLineView } from '../../data-access/sale.model';

export interface SaleQuantityDialogData {
  line: SaleCartLineView;
}

/** La cantidad nueva, **en unidad base**. `undefined` es haber cerrado sin cambiar nada. */
export type SaleQuantityDialogResult = number;

/**
 * Escribir la cantidad de una línea de un tirón (`F5`).
 *
 * Los `+` y `−` de la fila sirven para corregir de a una unidad; llevar una línea a doce con ellos
 * son once clics. Acá se tipea el número y se cierra con Enter, que es el gesto del mostrador: la
 * mano ya está en el teclado porque de ahí viene el atajo que abrió el diálogo.
 *
 * Escribe en la misma unidad en la que está cargada la línea —cajas si tiene empaque, unidades
 * sueltas si no— y devuelve siempre unidad base, que es la única que el carrito guarda (RN-16). La
 * equivalencia se dice abajo mientras se tipea: es lo único que evita que «2» se lea como dos
 * unidades cuando en realidad son dos cajas de doce.
 */
@Component({
  selector: 'app-sale-quantity-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    TranslatePipe,
  ],
  templateUrl: './sale-quantity-dialog.component.html',
  styleUrl: './sale-quantity-dialog.component.css',
})
export class SaleQuantityDialogComponent {
  protected readonly data = inject<SaleQuantityDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<SaleQuantityDialogComponent, SaleQuantityDialogResult>>(MatDialogRef);
  private readonly translate = inject(TranslateService);

  /** Cuánto vale una caja del empaque elegido, o `1` en una línea de unidades sueltas. */
  private readonly factor = computed(() => {
    const packaging = this.data.line.packaging;
    return packaging && packaging.factor > 0 ? packaging.factor : 1;
  });

  /** Lo que se tipea: cajas con empaque, unidades base sin él. Arranca en lo que ya tiene la línea. */
  protected readonly typed = signal(this.data.line.packageQuantity ?? this.data.line.quantity);

  protected readonly packagingName = computed(() => this.data.line.packaging?.name ?? null);

  /**
   * `min` y `step` los declara la unidad del producto, igual que en la fila: con `step="1"` fijo el
   * navegador marca como inválido el 1,5 de un producto que se vende por kilo. Con empaque el campo
   * cuenta cajas y la precisión se aplica del otro lado, sobre lo que resulta de multiplicar.
   */
  protected readonly step = computed<number | 'any'>(() =>
    this.data.line.packaging ? 'any' : quantityStep(quantityDecimalsOf(this.data.line.product)),
  );

  protected readonly min = computed<number | null>(() =>
    this.data.line.packaging ? null : minQuantity(quantityDecimalsOf(this.data.line.product)),
  );

  /** La cantidad en unidad base que se va a guardar. Es lo que la equivalencia pone en palabras. */
  protected readonly baseQuantity = computed(() => this.typed() * this.factor());

  /** «= 24 un», y sólo con empaque: sin él el número del campo ya está en unidad base. */
  protected readonly equivalence = computed(() => {
    if (!this.data.line.packaging) {
      return null;
    }

    const unit = this.data.line.product.unitMeasure;

    return this.translate.instant('sales.cart.packaging.equivalence', {
      quantity: this.baseQuantity(),
      unit: unit ? this.translate.instant(`products.unitMeasures.${unit}`) : '',
    });
  });

  /** Un cero o un número a medio escribir no cierran el diálogo: no hay línea de cantidad cero. */
  protected readonly isValid = computed(
    () => Number.isFinite(this.baseQuantity()) && this.baseQuantity() > 0,
  );

  protected onInput(value: string): void {
    const parsed = Number.parseFloat(value);
    this.typed.set(Number.isNaN(parsed) ? 0 : parsed);
  }

  protected onConfirm(): void {
    if (!this.isValid()) {
      return;
    }

    this.dialogRef.close(this.baseQuantity());
  }
}
