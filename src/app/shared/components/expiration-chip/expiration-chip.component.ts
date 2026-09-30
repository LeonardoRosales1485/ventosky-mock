import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../pipes/localized-date.pipe';

/** El semáforo de una partida, tal como lo nombra el backend (`ExpirationStatus`). */
export type ExpirationChipStatus = 'EXPIRED' | 'WARNING' | 'OK';

/**
 * El vencimiento de una partida con su semáforo: vencida, próxima a vencer o vigente.
 *
 * Es la misma pieza en la ficha del producto, el panel de vencimientos, el carrito y la
 * trazabilidad, por eso vive en `shared/`: no decide nada —el estado y los días los calcula el
 * backend con el umbral del producto—, sólo los pinta. Los días van como número y no como chip
 * porque «−19» dice cuánto hace y «4» cuánto falta, y los dos se ordenan.
 */
@Component({
  selector: 'app-expiration-chip',
  imports: [TranslatePipe, LocalizedDatePipe],
  template: `
    @if (expirationDate(); as date) {
      <span class="chip" [attr.data-tone]="tone()">
        <span class="chip__dot" aria-hidden="true"></span>
        <span class="chip__date">{{ date | localizedDate: 'shortDate' }}</span>
        @if (showDays() && days() !== null) {
          <span class="chip__days">
            @if (status() === 'EXPIRED') {
              {{ 'stock.expiration.expiredAgo' | translate: { days: -days()! } }}
            } @else {
              {{ 'stock.expiration.daysLeft' | translate: { days: days() } }}
            }
          </span>
        }
        <span class="sr-only">{{ 'stock.expiration.status.' + (status() ?? 'OK') | translate }}</span>
      </span>
    } @else {
      <span class="chip chip--none">{{ 'stock.expiration.none' | translate }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    /* Propuesta B: pill de estado con punto; la fecha va en mono. */
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      padding: 0 10px;
      border-radius: 999px;
      background: var(--vk-sunken);
      color: var(--vk-fg-2);
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
    }

    .chip__dot {
      flex: none;
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: currentColor;
    }

    .chip__date {
      font-family: var(--vk-font-mono);
      font-variant-numeric: tabular-nums;
    }

    .chip__days {
      font-size: 11.5px;
      opacity: 0.9;
    }

    .chip[data-tone='error'] {
      background: var(--vk-bad-soft);
      color: var(--vk-bad);
    }

    .chip[data-tone='warning'] {
      background: var(--vk-warn-soft);
      color: var(--vk-warn);
    }

    .chip[data-tone='success'] {
      background: var(--vk-ok-soft);
      color: var(--vk-ok);
    }

    .chip--none {
      color: var(--vk-fg-3);
    }
  `,
})
export class ExpirationChipComponent {
  /** `yyyy-MM-dd`, o nulo en la partida sin vencimiento. */
  readonly expirationDate = input<string | null | undefined>(null);
  readonly status = input<ExpirationChipStatus | null | undefined>(null);
  /** Días hasta el vencimiento, negativos si ya venció. */
  readonly days = input<number | null | undefined>(null);
  /** Si además de la fecha se dicen los días: sí en las grillas, no en una línea de carrito. */
  readonly showDays = input(true);

  protected readonly tone = computed(() => {
    switch (this.status()) {
      case 'EXPIRED':
        return 'error';
      case 'WARNING':
        return 'warning';
      case 'OK':
        return 'success';
      default:
        return 'neutral';
    }
  });
}
