import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { DelinquencyLevel } from '../account-availability.model';

const ICONS: Record<DelinquencyLevel, string> = {
  AL_DIA: 'check_circle',
  EN_MORA: 'schedule',
  MOROSO: 'warning',
  MOROSO_GRAVE: 'gpp_maybe',
};

/**
 * El nivel de morosidad de una cuenta, con el mismo aspecto en las pantallas donde aparece: la
 * ficha del titular y el panel del mostrador (§9.3). Vive en `core/` por eso mismo — el POS y la
 * nueva compra no pueden importarlo del feature de cuentas corrientes.
 *
 * **Los cuatro son informativos y ninguno bloquea nada**: el nivel lo decide una persona y dice en
 * qué estado de gestión está el caso, no qué puede hacer el mostrador. Lo único que frena una venta
 * a cuenta es el límite de deuda, y para frenar a un titular puntual está el `enabled` de la cuenta.
 * El color es una escala de gravedad, no de permisos.
 */
@Component({
  selector: 'app-delinquency-chip',
  imports: [MatIconModule, MatTooltipModule, TranslatePipe],
  template: `
    <span class="chip" [attr.data-level]="level()" [matTooltip]="meaning() | translate">
      <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
      <span>{{ 'checkingAccounts.delinquency.' + level() | translate }}</span>
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.125rem 0.5rem 0.125rem 0.375rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
      background: var(--chip-container);
      color: var(--chip-on-container);
      border: 1px solid color-mix(in srgb, var(--chip-on-container) 22%, transparent);
    }

    .chip mat-icon {
      font-size: 0.9375rem;
      width: 0.9375rem;
      height: 0.9375rem;
    }

    .chip[data-level='AL_DIA'] {
      --chip-container: var(--app-success-container);
      --chip-on-container: var(--app-on-success-container);
    }

    .chip[data-level='EN_MORA'] {
      --chip-container: var(--app-warning-container);
      --chip-on-container: var(--app-on-warning-container);
    }

    .chip[data-level='MOROSO'] {
      --chip-container: var(--app-error-container);
      --chip-on-container: var(--app-on-error-container);
    }

    /* El último se pinta lleno para que no se confunda con el anterior. No bloquea más que los
       otros tres —ninguno bloquea—: dice que el caso ya salió de la empresa. */
    .chip[data-level='MOROSO_GRAVE'] {
      --chip-container: var(--app-error);
      --chip-on-container: var(--mat-sys-on-error);
      border-color: transparent;
    }
  `,
})
export class DelinquencyChipComponent {
  readonly level = input.required<DelinquencyLevel>();

  /**
   * Qué significa el peldaño, en el tooltip. El nombre del nivel es una etiqueta —«EN MORA»— y no
   * dice qué se hizo al respecto; la frase sí, y es la que evita que cada pantalla la reescriba.
   */
  protected readonly meaning = computed(
    () => 'checkingAccounts.delinquencyDialog.means.' + this.level(),
  );

  protected readonly icon = computed(() => ICONS[this.level()]);
}
