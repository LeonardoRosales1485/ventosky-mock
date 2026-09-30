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
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/i18n/language.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  CheckingAccountAllocationRowDto,
  CheckingAccountDebtRowDto,
  ReassignRequest,
} from '../../data-access/checking-account.model';
import { DebtStateChipComponent } from '../debt-state-chip/debt-state-chip.component';

export interface ReassignDialogData {
  allocation: CheckingAccountAllocationRowDto;
  /** Lo que le queda vigente hoy: la cota superior de lo que se puede mover. */
  activeAmount: number;
  /** Deudas abiertas de la **misma** cuenta, sin la de origen. */
  debts: readonly CheckingAccountDebtRowDto[];
}

export type ReassignDialogResult = ReassignRequest;

const REASON_MIN_LENGTH = 5;

/**
 * Mover una imputación a otra deuda (§8.4, requerimiento R8).
 *
 * **Es una sola operación, no dos.** El backend inserta el `REVERSAL` y la `ALLOCATION` nueva en la
 * misma transacción, así que no hay ningún estado intermedio en el que el cobro quede en el aire — y
 * por eso el diálogo pide todo junto en vez de encadenar «desimputar» y después «imputar».
 *
 * La deuda destino tiene que ser de la misma cuenta: las dos cuentas de un tercero no se netean
 * (§8.5). Acá eso se resuelve solo, porque la lista que llega ya es la de esta cuenta.
 */
@Component({
  selector: 'app-reassign-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    DebtStateChipComponent,
  ],
  templateUrl: './reassign-dialog.component.html',
  styleUrl: './reassign-dialog.component.css',
})
export class ReassignDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<ReassignDialogComponent, ReassignDialogResult>>(MatDialogRef);

  protected readonly data = inject<ReassignDialogData>(MAT_DIALOG_DATA);

  private readonly language = inject(LanguageService);

  protected readonly debtUuid = signal<string>('');
  protected readonly amount = signal<number>(this.data.activeAmount);
  protected readonly reason = signal('');

  protected readonly target = computed(
    () => this.data.debts.find((debt) => debt.uuid === this.debtUuid()) ?? null,
  );

  /**
   * Las dos cotas del importe: lo que le queda vigente a la imputación y lo que la deuda destino
   * todavía debe. Las dos se vuelven a validar en el backend — acá sólo evitan el viaje.
   */
  protected readonly maxAmount = computed(() =>
    Math.min(this.data.activeAmount, this.target()?.pendingAmount ?? this.data.activeAmount),
  );

  protected readonly amountValid = computed(
    () => this.amount() > 0 && this.amount() <= this.maxAmount() + 0.005,
  );

  protected readonly canSubmit = computed(
    () => !!this.target() && this.amountValid() && this.reason().trim().length >= REASON_MIN_LENGTH,
  );

  /**
   * Un importe dentro de una frase: el aviso nombra los dos números —lo que la deuda debe y lo que
   * se está moviendo—, y partirlo para intercalar dos componentes lo dejaría intraducible.
   */
  protected formatAmount(value: number): string {
    return new Intl.NumberFormat(this.language.localeId(), {
      style: 'currency',
      currency: 'ARS',
      maximumFractionDigits: 2,
    }).format(value);
  }

  protected onTargetChange(uuid: string): void {
    this.debtUuid.set(uuid);
    // Si la deuda elegida debe menos de lo que se iba a mover, el importe se acota solo: es lo que el
    // backend va a exigir igual, y descubrirlo al confirmar seria friccion sin ganancia.
    if (this.amount() > this.maxAmount()) {
      this.amount.set(this.maxAmount());
    }
  }

  protected onAmountChange(value: string): void {
    const parsed = Number(value);
    this.amount.set(Number.isFinite(parsed) ? round(parsed) : 0);
  }

  protected onConfirm(): void {
    const target = this.target();
    if (!this.canSubmit() || !target) {
      return;
    }
    this.dialogRef.close({
      debtUuid: target.uuid,
      amount: this.amount(),
      reason: this.reason().trim(),
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
