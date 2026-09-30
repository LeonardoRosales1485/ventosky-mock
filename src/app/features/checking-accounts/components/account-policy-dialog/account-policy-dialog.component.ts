import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import {
  CheckingAccountPolicyDto,
  SaveAccountPolicyRequest,
} from '../../data-access/checking-account-policy.model';

export interface AccountPolicyDialogData {
  partyName: string;
  /** La política ya leída, con el `resolved` de lo que le rige hoy. */
  policy: CheckingAccountPolicyDto;
  /**
   * En la ficha de un proveedor el límite ni se ofrece: en una compra no se valida ningún tope
   * —cuánto nos fía un proveedor lo decide el proveedor—, y mostrar uno que nadie mira es una
   * invitación a que alguien lo implemente.
   */
  showsLimit: boolean;
}

export type AccountPolicyDialogResult = SaveAccountPolicyRequest;

/**
 * El override de un titular, parámetro por parámetro.
 *
 * **«Heredar» es cómo se saca un override**, no una ausencia: la fila queda pero ese parámetro deja
 * de decidir y vuelve a lo que diga la empresa. No hay «borrar política» — dos caminos para lo mismo
 * dejarían uno sin usar.
 *
 * **Modo y valor son dos controles y no un campo.** Heredar, «sin tope» y fijar un número son tres
 * respuestas distintas, y un campo en blanco no distingue la primera de la segunda. Confundirlas es
 * el error caro del módulo.
 *
 * **Lo heredado se muestra con el valor que rige, en gris, y no vacío**: la pantalla contesta qué le
 * pasaría a este titular si nadie decide nada.
 *
 * **Sin motivo.** Configurar toca varios parámetros a la vez, y un motivo por guardado no diría de
 * cuál de ellos habla. Lo que sí queda es una fila en el extracto por cada parámetro que cambió, con
 * la declaración anterior y la nueva.
 */
@Component({
  selector: 'app-account-policy-dialog',
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
    FormsModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './account-policy-dialog.component.html',
  styleUrl: './account-policy-dialog.component.css',
})
export class AccountPolicyDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<AccountPolicyDialogComponent, AccountPolicyDialogResult>>(MatDialogRef);

  protected readonly data = inject<AccountPolicyDialogData>(MAT_DIALOG_DATA);

  protected readonly resolved = this.data.policy.resolved;

  protected readonly dueDaysMode = signal<'INHERIT' | 'VALUE'>(
    this.data.policy.dueDaysMode === 'VALUE' ? 'VALUE' : 'INHERIT',
  );
  protected readonly dueDays = signal<number | null>(
    this.data.policy.dueDays ?? this.resolved.dueDays,
  );

  protected readonly limitMode = signal<'INHERIT' | 'UNLIMITED' | 'AMOUNT'>(
    this.data.policy.debtLimitMode === 'AMOUNT'
      ? 'AMOUNT'
      : this.data.policy.debtLimitMode === 'UNLIMITED'
        ? 'UNLIMITED'
        : 'INHERIT',
  );
  protected readonly debtLimit = signal<number | null>(
    this.data.policy.debtLimitAmount ?? this.resolved.debtLimit,
  );

  protected readonly allocationMode = signal<'INHERIT' | 'AUTOMATIC' | 'MANUAL'>(
    this.data.policy.allocationMode,
  );

  /**
   * Si el guardado cambiaría alguna **declaración**.
   *
   * Se comparan las declaraciones y no los valores resueltos: pasar de heredar a fijar 30 puede dar
   * el mismo número y sin embargo este titular dejó de heredar, que es justo lo que la fila del
   * extracto tiene que decir.
   */
  protected readonly hasChanges = computed(() => {
    const before = this.data.policy;
    if (this.dueDaysMode() !== (before.dueDaysMode === 'VALUE' ? 'VALUE' : 'INHERIT')) {
      return true;
    }
    if (this.dueDaysMode() === 'VALUE' && this.dueDays() !== before.dueDays) {
      return true;
    }
    if (this.data.showsLimit) {
      const beforeLimitMode =
        before.debtLimitMode === 'AMOUNT'
          ? 'AMOUNT'
          : before.debtLimitMode === 'UNLIMITED'
            ? 'UNLIMITED'
            : 'INHERIT';
      if (this.limitMode() !== beforeLimitMode) {
        return true;
      }
      if (this.limitMode() === 'AMOUNT' && this.debtLimit() !== before.debtLimitAmount) {
        return true;
      }
    }
    return this.allocationMode() !== before.allocationMode;
  });

  /** Qué dice la empresa para este parámetro, que es lo que rige si acá se elige heredar. */
  protected readonly dueDaysIsOwn = computed(() => this.resolved.dueDaysSource === 'ACCOUNT');
  protected readonly limitIsOwn = computed(() => this.resolved.debtLimitSource === 'ACCOUNT');
  protected readonly allocationIsOwn = computed(
    () => this.resolved.allocationModeSource === 'ACCOUNT',
  );

  protected onSave(): void {
    this.dialogRef.close({
      dueDaysMode: this.dueDaysMode(),
      dueDays: this.dueDaysMode() === 'VALUE' ? this.dueDays() : null,
      debtLimitMode: this.data.showsLimit ? this.limitMode() : 'INHERIT',
      debtLimitAmount:
        this.data.showsLimit && this.limitMode() === 'AMOUNT' ? this.debtLimit() : null,
      allocationMode: this.allocationMode(),
    });
  }
}
