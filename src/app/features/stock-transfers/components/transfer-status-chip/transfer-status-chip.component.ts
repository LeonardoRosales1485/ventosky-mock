import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TransferStatus } from '../../data-access/stock-transfer.model';

/**
 * El estado del traslado, pintado según lo que le pide al que lo mira.
 *
 * «En viaje» tiene dos colores y no es un capricho: el mismo estado es información cuando el
 * traslado salió de acá —no hay nada que hacer, está en manos del destino— y es una tarea pendiente
 * cuando entra acá, porque hasta que alguien lo confirme esas unidades no están en ningún saldo.
 * Quien decide cuál de los dos es la pantalla, que sabe cuál es la sucursal activa.
 */
@Component({
  selector: 'app-transfer-status-chip',
  imports: [TranslatePipe],
  template: `
    <span class="chip" [attr.data-tone]="tone()">
      {{ 'stockTransfers.status.' + status() | translate }}
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

    .chip[data-tone='info'] {
      --chip-container: var(--app-info-container);
      --chip-on-container: var(--app-on-info-container);
    }

    .chip[data-tone='warning'] {
      --chip-container: var(--app-warning-container);
      --chip-on-container: var(--app-on-warning-container);
    }

    .chip[data-tone='success'] {
      --chip-container: var(--app-success-container);
      --chip-on-container: var(--app-on-success-container);
    }

    /* Cancelado no es un estado "malo": es un traslado que ya no cuenta. Gris y tachado. */
    .chip[data-tone='neutral'] {
      --chip-container: var(--mat-sys-surface-container-highest);
      --chip-on-container: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
  `,
})
export class TransferStatusChipComponent {
  readonly status = input.required<TransferStatus>();

  /**
   * Si el traslado espera algo de **esta** sucursal. Sólo cambia el tono de «En viaje»: lo que hay
   * que recibir se lee distinto de lo que ya salió.
   */
  readonly awaitingHere = input(false);

  protected readonly tone = computed(() => {
    switch (this.status()) {
      case 'RECEIVED':
        return 'success';
      case 'IN_TRANSIT':
        return this.awaitingHere() ? 'warning' : 'info';
      case 'PENDING':
        return 'info';
      default:
        return 'neutral';
    }
  });
}
