import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CreditState, DebtState } from '../../data-access/checking-account.model';

/**
 * El estado de una partida — deuda o crédito — como lo informa §7.1: derivado de la fila, nunca
 * transicionado. El componente sólo lo pinta; quien lo calcula es `debtState` / `creditState`.
 */
@Component({
  selector: 'app-debt-state-chip',
  imports: [TranslatePipe],
  template: `
    <span class="chip" [attr.data-state]="state()">
      {{ 'checkingAccounts.states.' + state() | translate }}
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      padding: 0.125rem 0.5rem;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
      background: var(--chip-container);
      color: var(--chip-on-container);
    }

    .chip[data-state='PENDIENTE'] {
      --chip-container: var(--app-info-container);
      --chip-on-container: var(--app-on-info-container);
    }

    .chip[data-state='PARCIAL'],
    .chip[data-state='SIN_IMPUTAR'] {
      --chip-container: var(--app-warning-container);
      --chip-on-container: var(--app-on-warning-container);
    }

    .chip[data-state='VENCIDA'] {
      --chip-container: var(--app-error-container);
      --chip-on-container: var(--app-on-error-container);
    }

    .chip[data-state='PAGADA'],
    .chip[data-state='IMPUTADO'] {
      --chip-container: var(--app-success-container);
      --chip-on-container: var(--app-on-success-container);
    }

    /* Anulada no es un estado "malo": es una fila que ya no cuenta. Va en gris y no en rojo. */
    .chip[data-state='ANULADA'],
    .chip[data-state='ANULADO'] {
      --chip-container: var(--mat-sys-surface-container-highest);
      --chip-on-container: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
  `,
})
export class DebtStateChipComponent {
  readonly state = input.required<DebtState | CreditState>();
}
