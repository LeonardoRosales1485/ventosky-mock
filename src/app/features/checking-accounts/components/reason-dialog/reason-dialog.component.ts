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
import { FormField, form, minLength, required, submit } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';

export interface ReasonDialogData {
  titleKey: string;
  messageKey: string;
  /** Parámetros de interpolación del mensaje (número de comprobante, importe, titular). */
  messageParams?: Record<string, string | number>;
  confirmKey: string;
  /** Pinta el botón de confirmar como una acción destructiva. */
  destructive?: boolean;
  /** Bloque de contexto que el diálogo muestra sobre el campo (el antes y el después). */
  details?: readonly { labelKey: string; value: string }[];
}

const REASON_MIN_LENGTH = 5;

/**
 * El motivo obligatorio, una sola vez.
 *
 * Desimputar, anular un cobro y anular una compensación piden lo mismo —una explicación que queda
 * en auditoría— y se diferencian sólo en el texto y en el contexto que muestran antes de pedirla.
 * Tenerlo en un diálogo evita tres formularios que sólo se distinguen por su título, y evita que
 * alguno de los tres se olvide de exigir el campo.
 */
@Component({
  selector: 'app-reason-dialog',
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
  templateUrl: './reason-dialog.component.html',
  styleUrl: './reason-dialog.component.css',
})
export class ReasonDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ReasonDialogComponent, string>);
  protected readonly data = inject<ReasonDialogData>(MAT_DIALOG_DATA);

  private readonly model = signal({ reason: '' });

  protected readonly reasonForm = form(this.model, (path) => {
    required(path.reason);
    minLength(path.reason, REASON_MIN_LENGTH);
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.reasonForm().invalid()) {
      this.reasonForm().markAsTouched();
      return;
    }

    void submit(this.reasonForm, async () => {
      this.dialogRef.close(this.model().reason.trim());
    });
  }
}
