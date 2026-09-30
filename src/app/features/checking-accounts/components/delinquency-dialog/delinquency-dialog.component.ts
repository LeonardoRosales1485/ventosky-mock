import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormField, form, minLength, required, submit } from '@angular/forms/signals';
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
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  DelinquencyEventDto,
  DelinquencyLevelValue,
} from '../../data-access/checking-account-policy.model';

export interface DelinquencyDialogData {
  partyName: string;
  currentLevel: DelinquencyLevelValue;
  /** Los dos números que sí están calculados. Van al lado de los niveles, no en otra pantalla. */
  overdueAmount: number | null;
  oldestOverdueDays: number | null;
  /**
   * El historial, del más nuevo al más viejo, **en la misma pantalla**: la pregunta real no es «qué
   * nivel tiene» sino «¿desde cuándo está en estudio jurídico y quién lo decidió?», y separarla en
   * otra vista obliga a abrir dos cosas para contestar una.
   */
  history: readonly DelinquencyEventDto[];
}

export interface DelinquencyDialogResult {
  level: DelinquencyLevelValue;
  reason: string;
}

const REASON_MIN_LENGTH = 5;

export const DELINQUENCY_LEVELS: readonly DelinquencyLevelValue[] = [
  'AL_DIA',
  'EN_MORA',
  'MOROSO',
  'MOROSO_GRAVE',
];

/**
 * Fijar el nivel de morosidad de una cuenta.
 *
 * **El nivel no se calcula: lo decide una persona.** A un moroso de verdad se lo manda a un estudio
 * jurídico, y desde ahí el estado del caso vive afuera del sistema —una demanda, un acuerdo firmado
 * en papel, plata que entró por un canal que no es la caja—. Por eso el diálogo pide una decisión y
 * no muestra una sugerencia: una escalera calculada contestaría con total seguridad una pregunta que
 * no puede responder.
 *
 * **El motivo es obligatorio**, y es lo único que hace que la etiqueta sirva años después, que es
 * justo cuando se pregunta: «¿desde cuándo esta cuenta está en estudio jurídico, y quién lo
 * decidió?».
 *
 * **Al lado, siempre, los dos números que sí están calculados**: el vencido y los días de la deuda
 * más antigua. El chip dice lo que alguien decidió, los números dicen lo que pasó, y que coincidan o
 * no es justamente la información — quien decide tiene que ver las dos cosas juntas.
 *
 * Ninguno de los cuatro niveles bloquea nada, y el diálogo no insinúa lo contrario: no hay advertencia
 * de que marcar `MOROSO_GRAVE` vaya a frenar una venta, porque no la frena.
 */
@Component({
  selector: 'app-delinquency-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    FormsModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    CurrencyDisplayComponent,
    LocalizedDatePipe,
  ],
  templateUrl: './delinquency-dialog.component.html',
  styleUrl: './delinquency-dialog.component.css',
})
export class DelinquencyDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<DelinquencyDialogComponent, DelinquencyDialogResult>>(MatDialogRef);
  protected readonly data = inject<DelinquencyDialogData>(MAT_DIALOG_DATA);

  protected readonly levels = DELINQUENCY_LEVELS;
  protected readonly level = signal<DelinquencyLevelValue>(this.data.currentLevel);

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
      this.dialogRef.close({ level: this.level(), reason: this.model().reason.trim() });
    });
  }
}
