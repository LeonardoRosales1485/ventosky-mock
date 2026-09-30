import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
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
import { LanguageService } from '../../../../core/i18n/language.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import {
  AdjustmentDirection,
  PartyRole,
  addDays,
  parseIsoDate,
  toIsoDate,
  todayIso,
} from '../../data-access/checking-account.model';

export interface BalanceAdjustmentDialogData {
  partyName: string;
  /** Decide los carteles de los dos sentidos, no la aritmética: el saldo sube igual en los dos. */
  role: PartyRole;
  balance: number;
  /**
   * Los días de plazo que le rigen al titular, ya resueltos por la escalera de políticas.
   *
   * Sirven para **proponer** el vencimiento del ajuste en contra. La propuesta se puede cambiar
   * porque el ajuste no tiene una fecha de operación que lo ancle: quien corrige un error de hace dos
   * meses sabe cuándo debería haber vencido eso, y el sistema no.
   */
  dueDays: number;
}

export interface BalanceAdjustmentDialogResult {
  direction: AdjustmentDirection;
  amount: number;
  /** Sólo en un `DEBIT`. Un crédito no vence, y mandarlo sería pedir algo que el backend rechaza. */
  dateDue: string | null;
  reason: string;
}

const MIN_REASON_LENGTH = 5;

/**
 * Ajuste manual del saldo: una corrección sin operación comercial detrás, siempre con motivo (§3).
 *
 * Los dos sentidos son partidas de verdad, no un `balance += x`: un ajuste en contra nace como
 * deuda —con su vencimiento, calculado con la política resuelta— y uno a favor como crédito, que
 * se imputa como cualquier otro. Es lo que mantiene el invariante de §4.3 después de ajustar, y lo
 * que hace que el ajuste se vea en el extracto como todo lo demás.
 *
 * **El saldo resultante que muestra es una proyección de la pantalla**, no la respuesta del
 * servidor: sirve para que quien ajusta vea a dónde va a llegar antes de confirmar. El saldo que
 * queda lo devuelve el backend recalculado desde las partidas, y es el que la ficha vuelve a pintar.
 */
@Component({
  selector: 'app-balance-adjustment-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  // Mismo criterio que el diálogo de prórroga: el calendario nativo cae al locale del navegador, y
  // en una máquina en inglés mostraría `8/24/2026` en una pantalla que escribe en español.
  providers: [
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useFactory: () => inject(LanguageService).localeId() },
  ],
  templateUrl: './balance-adjustment-dialog.component.html',
  styleUrl: './balance-adjustment-dialog.component.css',
})
export class BalanceAdjustmentDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<BalanceAdjustmentDialogComponent, BalanceAdjustmentDialogResult>>(
      MatDialogRef,
    );
  protected readonly data = inject<BalanceAdjustmentDialogData>(MAT_DIALOG_DATA);

  protected readonly direction = signal<AdjustmentDirection>('DEBIT');
  protected readonly amount = signal<number | null>(null);
  protected readonly reason = signal('');

  /** La propuesta de la política, editable. Sólo se manda cuando el ajuste es en contra. */
  protected readonly dueDate = signal<Date>(
    parseIsoDate(addDays(todayIso(), this.data.dueDays)),
  );

  protected readonly minDueDate = parseIsoDate(todayIso());

  protected readonly isDebit = computed(() => this.direction() === 'DEBIT');

  protected readonly projectedBalance = computed(() => {
    const amount = this.amount() ?? 0;
    const delta = this.isDebit() ? amount : -amount;
    return round(this.data.balance + delta);
  });

  protected readonly canSubmit = computed(
    () => (this.amount() ?? 0) > 0 && this.reason().trim().length >= MIN_REASON_LENGTH,
  );

  protected onAmountChange(value: string): void {
    const parsed = Number(value);
    this.amount.set(Number.isFinite(parsed) && parsed > 0 ? round(parsed) : null);
  }

  protected onDueDateChange(value: Date | null): void {
    if (value) {
      this.dueDate.set(value);
    }
  }

  protected onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.dialogRef.close({
      direction: this.direction(),
      amount: this.amount() ?? 0,
      dateDue: this.isDebit() ? toIsoDate(this.dueDate()) : null,
      reason: this.reason().trim(),
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
