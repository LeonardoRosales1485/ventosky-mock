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
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  AllocationInput,
  CheckingAccountCreditRowDto,
  CheckingAccountDebtRowDto,
  PartyRole,
} from '../../data-access/checking-account.model';
import { DebtStateChipComponent } from '../debt-state-chip/debt-state-chip.component';

export interface AllocateDialogData {
  credit: CheckingAccountCreditRowDto;
  partyName: string;
  role: PartyRole;
  /** Deudas abiertas de **esa** cuenta, ya en orden FIFO: las devuelve así el backend. */
  debts: readonly CheckingAccountDebtRowDto[];
}

export type AllocateDialogResult = readonly AllocationInput[];

/**
 * Imputar un crédito a las deudas de su cuenta (§8.2).
 *
 * Abre con la propuesta FIFO ya cargada y la deja editar entera: es lo que hace que la imputación
 * manual sea rápida en el caso común —«aplicalo como corresponde»— sin dejar de ser manual cuando
 * el cliente dice a qué factura va su pago.
 *
 * Las dos cotas se validan acá y se vuelven a validar en la API: ninguna línea puede superar el
 * pendiente de su deuda, y la suma no puede superar lo que al crédito le queda sin imputar.
 */
@Component({
  selector: 'app-allocate-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    DebtStateChipComponent,
  ],
  templateUrl: './allocate-dialog.component.html',
  styleUrl: './allocate-dialog.component.css',
})
export class AllocateDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<AllocateDialogComponent, AllocateDialogResult>>(MatDialogRef);
  protected readonly data = inject<AllocateDialogData>(MAT_DIALOG_DATA);

  private readonly amounts = signal<Record<string, number>>(
    proposeFifo(this.data.debts, this.data.credit.unallocatedAmount),
  );

  /**
   * El estado llega calculado del backend y se pinta tal cual. Derivarlo acá —contra el reloj de la
   * máquina del operador— mostraría un estado distinto del que el sistema usa para decidir.
   *
   * «Prorrogada» sí se deriva, y se puede: es comparar dos fechas que ya vienen en la fila, sin
   * reloj de por medio.
   */
  protected readonly rows = computed(() =>
    this.data.debts.map((debt) => ({
      debt,
      state: debt.state,
      extended: !!debt.dateDueOriginal && debt.dateDueOriginal !== debt.dateDue,
      amount: this.amounts()[debt.uuid] ?? 0,
    })),
  );

  protected readonly totalAllocated = computed(() =>
    round(Object.values(this.amounts()).reduce((total, amount) => total + amount, 0)),
  );

  protected readonly remaining = computed(() =>
    round(this.data.credit.unallocatedAmount - this.totalAllocated()),
  );

  /** Sobrepasarse es el único error posible acá; el resto lo acota el `max` de cada input. */
  protected readonly exceedsCredit = computed(() => this.remaining() < -0.005);

  protected readonly canSubmit = computed(() => this.totalAllocated() > 0 && !this.exceedsCredit());

  protected onAmountChange(debtUuid: string, value: string): void {
    const debt = this.data.debts.find((row) => row.uuid === debtUuid);
    const parsed = Number(value);
    const amount =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(round(parsed), debt?.pendingAmount ?? 0) : 0;

    this.amounts.update((current) => ({ ...current, [debtUuid]: amount }));
  }

  protected onProposeFifo(): void {
    this.amounts.set(proposeFifo(this.data.debts, this.data.credit.unallocatedAmount));
  }

  protected onClear(): void {
    this.amounts.set({});
  }

  protected onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.dialogRef.close(
      Object.entries(this.amounts())
        .filter(([, amount]) => amount > 0)
        .map(([debtUuid, amount]) => ({ debtUuid, amount })),
    );
  }
}

/**
 * La propuesta que abre el diálogo: el mismo reparto que haría el FIFO, **sólo para proponer**.
 *
 * Que acá haya una copia de la regla no contradice que la previa de la pantalla de cobro la calcule
 * el backend: allá lo que se muestra es lo que va a pasar —y tiene que coincidir—, acá es un punto de
 * partida que el usuario va a editar. Si difiriera del FIFO real no habría ningún problema: lo que se
 * manda es lo que quedó escrito en los campos.
 */
function proposeFifo(
  debts: readonly CheckingAccountDebtRowDto[],
  available: number,
): Record<string, number> {
  let remaining = round(available);
  const amounts: Record<string, number> = {};

  for (const debt of debts) {
    if (remaining <= 0) {
      break;
    }
    const applied = Math.min(remaining, debt.pendingAmount);
    amounts[debt.uuid] = applied;
    remaining = round(remaining - applied);
  }

  return amounts;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
