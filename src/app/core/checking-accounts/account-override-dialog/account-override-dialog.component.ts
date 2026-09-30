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
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService } from '../../i18n/language.service';
import { CurrencyDisplayComponent } from '../../../shared/components/currency-display/currency-display.component';
import { FieldErrorPipe } from '../../../shared/pipes/field-error.pipe';
import { AccountDebtLimitDetail } from '../account-availability.model';

export interface AccountOverrideDialogData {
  partyName: string;
  /** El detalle que mandó el backend con el rechazo. Los números salen de acá, no de la pantalla. */
  detail: AccountDebtLimitDetail;
  /**
   * Si quien está en el mostrador puede autorizar la excepción.
   *
   * **Sin el permiso el diálogo se abre igual**, con el bloque de forzado deshabilitado y el nombre
   * del permiso a la vista: un «no se puede» a secas manda al cajero a llamar por teléfono sin saber
   * qué pedir, y las dos salidas de arriba —llevar lo que entra, cobrar el resto por otro medio— no
   * dependen de ningún permiso.
   */
  canOverride: boolean;
}

/** El motivo con el que se autoriza. Cerrar sin confirmar no devuelve nada. */
export type AccountOverrideDialogResult = string;

const REASON_MIN_LENGTH = 5;

/**
 * La excepción autorizada: cerrar una venta que deja al cliente por encima de su límite (§10, #4).
 *
 * **Es el único de los cuatro rechazos del portón que se puede forzar**, y no por severidad sino
 * porque es el único donde hay algo que forzar — un comprobante que no mueve balance no genera
 * deuda, una venta sin tercero no tiene cuenta donde imputar, y una cuenta deshabilitada se
 * rehabilita en la cuenta, que es una decisión distinta y de otra persona.
 *
 * **El motivo es obligatorio.** Una deuda por encima del límite sin nada que la explique es
 * exactamente el registro que la excepción existe para evitar: el backend lo estampa en la deuda
 * junto con quién autorizó y cuánto se pasó, y eso es lo que se lee cuando alguien pregunta, meses
 * después, por qué este cliente llegó hasta acá.
 *
 * **Los números los manda el backend** —el exceso, el disponible, el límite— y el diálogo los pinta.
 * Recalcularlos acá sería tener dos aritméticas para el mismo rechazo.
 *
 * **Ofrece el máximo y no sólo el rechazo.** Un «no entra» a secas manda al cajero a llamar por
 * teléfono; con el disponible a la vista, las dos salidas —llevar lo que entra a cuenta y cobrar el
 * resto por otro medio— quedan disponibles sin autorizar nada.
 *
 * **Sólo se valida la porción a cuenta**, no el total de la venta: lo que se cobra por otro medio no
 * consume límite.
 */
@Component({
  selector: 'app-account-override-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    FormsModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './account-override-dialog.component.html',
  styleUrl: './account-override-dialog.component.css',
})
export class AccountOverrideDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<AccountOverrideDialogComponent, AccountOverrideDialogResult>>(MatDialogRef);

  protected readonly data = inject<AccountOverrideDialogData>(MAT_DIALOG_DATA);

  private readonly language = inject(LanguageService);

  private readonly model = signal({ reason: '' });

  protected readonly reasonForm = form(this.model, (path) => {
    required(path.reason);
    minLength(path.reason, REASON_MIN_LENGTH);
  });

  /** Lo que sí entra ahora mismo. Es el número que el diálogo propone antes que cualquier otro. */
  protected readonly available = this.data.detail.available ?? 0;

  /**
   * Un importe dentro de una frase.
   *
   * Las tres salidas son oraciones —«llevar $20.000 a cuenta»— y no filas de una tabla: partirlas
   * para intercalar un `app-currency-display` las dejaría con saltos donde no van.
   */
  protected formatAmount(value: number): string {
    return new Intl.NumberFormat(this.language.localeId(), {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(value);
  }

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
