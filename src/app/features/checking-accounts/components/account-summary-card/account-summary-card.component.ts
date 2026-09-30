import { Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type SummaryCardTone = 'neutral' | 'positive' | 'warning' | 'danger';

/**
 * Una tarjeta del encabezado: un rótulo, un número grande y una línea que lo explica.
 *
 * El valor entra por proyección y no por `input` porque no siempre es un importe —a veces es una
 * cuenta de cuentas, a veces una barra de consumo del límite—, y la tarjeta no tiene por qué saber
 * formatear todo eso.
 */
@Component({
  selector: 'app-account-summary-card',
  imports: [MatIconModule],
  template: `
    <section class="card" [attr.data-tone]="tone()">
      <header class="card__header">
        <span class="card__label">{{ label() }}</span>
        @if (icon()) {
          <mat-icon class="card__icon" aria-hidden="true">{{ icon() }}</mat-icon>
        }
      </header>

      <div class="card__value">
        <ng-content />
      </div>

      @if (hint()) {
        <p class="card__hint">{{ hint() }}</p>
      }

      <ng-content select="[cardFooter]" />
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      height: 100%;
      padding: 0.875rem 1rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 0.75rem;
      background: var(--mat-sys-surface-container-low);
    }

    .card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .card__label {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
    }

    .card__icon {
      font-size: 1.125rem;
      width: 1.125rem;
      height: 1.125rem;
      color: var(--accent, var(--mat-sys-on-surface-variant));
    }

    .card__value {
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1.2;
      color: var(--accent, var(--mat-sys-on-surface));
      overflow-wrap: anywhere;
    }

    .card__hint {
      margin: 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .card[data-tone='positive'] {
      --accent: var(--app-success);
    }

    .card[data-tone='warning'] {
      --accent: var(--app-warning);
    }

    .card[data-tone='danger'] {
      --accent: var(--app-error);
    }
  `,
})
export class AccountSummaryCardComponent {
  readonly label = input.required<string>();
  readonly hint = input<string>();
  readonly icon = input<string>();
  readonly tone = input<SummaryCardTone>('neutral');
}
