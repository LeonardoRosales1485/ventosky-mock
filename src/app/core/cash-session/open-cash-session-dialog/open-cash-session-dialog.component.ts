import { Component, inject, signal } from '@angular/core';
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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { FormField, form, required, submit, validate } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../shared/pipes/field-error.pipe';

export interface OpenCashSessionDialogData {
  /** Qué caja se está por abrir. Con varias cajas, el nombre es lo único que las distingue. */
  cashRegisterName: string;
}

export interface OpenCashSessionDialogResult {
  openingAmount: number;
}

interface OpenCashSessionFormModel {
  openingAmount: number | null;
}

/**
 * El monto con el que arranca la caja, lo único que hace falta para abrirla.
 *
 * Arranca en cero y no vacío porque abrir sin fondo fijo es el caso corriente: así el flujo entero
 * es abrir y confirmar. El número no es decorativo —es contra lo que después se cuenta la caja—, de
 * ahí que se pida en vez de asumirlo.
 */
@Component({
  selector: 'app-open-cash-session-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './open-cash-session-dialog.component.html',
  styleUrl: './open-cash-session-dialog.component.css',
})
export class OpenCashSessionDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<OpenCashSessionDialogComponent, OpenCashSessionDialogResult>,
  );

  protected readonly data = inject<OpenCashSessionDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal<OpenCashSessionFormModel>({ openingAmount: 0 });

  protected readonly openForm = form(this.model, (path) => {
    required(path.openingAmount);
    // El backend acepta cero —una caja sin fondo fijo—, pero no un negativo: no existe arrancar
    // debiendo plata.
    validate(path.openingAmount, ({ value }) => {
      const amount = value();
      if (amount === null) {
        return null; // `required` ya reporta el vacío.
      }

      return amount < 0 ? { kind: 'min', min: 0 } : null;
    });
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.openForm().invalid()) {
      this.openForm().markAsTouched();
      return;
    }

    void submit(this.openForm, async () => {
      const openingAmount = this.model().openingAmount;
      if (openingAmount === null) {
        return;
      }

      this.dialogRef.close({ openingAmount });
    });
  }
}
