import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
import { debounceTime, of, switchMap } from 'rxjs';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import {
  CheckingAccountAllocationRowDto,
  ReverseRequest,
  ReversePreviewDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { DebtStateChipComponent } from '../debt-state-chip/debt-state-chip.component';

export interface ReverseDialogData {
  allocation: CheckingAccountAllocationRowDto;
  /** Lo que le queda vigente hoy: la cota superior del importe a revertir. */
  activeAmount: number;
}

export type ReverseDialogResult = ReverseRequest;

const REASON_MIN_LENGTH = 5;

/**
 * Desimputar, total o parcialmente (§8.4).
 *
 * **El antes y el después lo calcula el backend**, no esta pantalla. El dato que importa —que la
 * deuda vuelva a estar `VENCIDA`— se deriva contra la fecha de hoy, y derivarlo acá dejaría que un
 * reloj corrido en la máquina del operador mostrara un aviso que el sistema no comparte.
 *
 * **Lo que el diálogo no dice, y es a propósito: nada sobre el límite de deuda.** Desimputar no
 * cambia el saldo de la cuenta —la deuda vuelve a pendiente y el cobro vuelve a disponible por el
 * mismo importe—, así que un aviso de límite sería alarmar por algo que no pasa. Lo que sí cambia es
 * la composición, y eso es lo que se muestra.
 */
@Component({
  selector: 'app-reverse-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    DebtStateChipComponent,
  ],
  templateUrl: './reverse-dialog.component.html',
  styleUrl: './reverse-dialog.component.css',
})
export class ReverseDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<ReverseDialogComponent, ReverseDialogResult>>(MatDialogRef);
  private readonly api = inject(CheckingAccountsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<ReverseDialogData>(MAT_DIALOG_DATA);

  /** Arranca en todo lo vigente: el caso común es deshacer entero. */
  protected readonly amount = signal<number>(this.data.activeAmount);
  protected readonly reason = signal('');
  protected readonly preview = signal<ReversePreviewDto | null>(null);

  protected readonly amountValid = computed(
    () => this.amount() > 0 && this.amount() <= this.data.activeAmount + 0.005,
  );

  protected readonly reasonValid = computed(() => this.reason().trim().length >= REASON_MIN_LENGTH);

  protected readonly canSubmit = computed(() => this.amountValid() && this.reasonValid());

  /** El estado de la deuda cambia por esta reversión: es lo que hay que ver antes de confirmar. */
  protected readonly stateChanges = computed(() => {
    const preview = this.preview();
    return !!preview && preview.debtState !== preview.debtStateAfter;
  });

  constructor() {
    // Con freno: el importe se mueve con el teclado y cada tecleo no tiene por qué ser una consulta.
    toObservable(this.amount)
      .pipe(
        debounceTime(250),
        switchMap((amount) =>
          amount > 0 && amount <= this.data.activeAmount + 0.005
            ? this.api.previewReverse(this.data.allocation.uuid, amount)
            : of(null),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (preview) => this.preview.set(preview),
        // Una previa que falla no bloquea la operación: es información, no una validación.
        error: () => this.preview.set(null),
      });
  }

  protected onAmountChange(value: string): void {
    const parsed = Number(value);
    this.amount.set(Number.isFinite(parsed) ? round(parsed) : 0);
  }

  protected onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.dialogRef.close({
      // Se manda siempre, incluso cuando coincide con lo vigente: entre que se abrió el diálogo y se
      // confirma, otra persona pudo revertir una parte, y mandar el importe explícito hace que el
      // backend rechace en vez de deshacer más de lo que se vio.
      amount: this.amount(),
      reason: this.reason().trim(),
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
