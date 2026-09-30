import { Component, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * De qué peldaño salió un valor heredado.
 *
 * Sin la marca de origen, «bloquear la venta» no distingue una decisión que alguien tomó para esta
 * sucursal de una que viene de la empresa o del valor por defecto de la aplicación — y esa
 * diferencia es justo la que hay que ver antes de tocar el peldaño de arriba.
 *
 * **Dos tonos y no cinco.** El chip destaca sólo el nivel que se está editando: lo que se ve
 * resaltado es lo que este nivel definió, y en gris queda todo lo heredado. El nombre del nivel va
 * en la etiqueta, que es donde se lee sin decodificar un color.
 *
 * El vocabulario de niveles lo pone quien lo usa —`{@link translationPrefix}` más el valor de
 * `source`—, así que sirve igual para la escalera de configuración
 * (`DEFAULT / GLOBAL / COMPANY / BRANCH / USER`) y para la de cuentas corrientes
 * (`DEFAULT / COMPANY / ACCOUNT`). `shared/` no conoce ninguna de las dos.
 */
@Component({
  selector: 'app-setting-source',
  imports: [MatTooltipModule, TranslatePipe],
  template: `
    <div class="source" [class.source--inline]="!label()">
      @if (label(); as text) {
        <span class="source__label">{{ text }}</span>
      }
      <span class="source__value"><ng-content /></span>
      <span
        class="source__chip"
        [class.source__chip--own]="isOwn()"
        [matTooltip]="translationPrefix() + '.hints.' + source() | translate"
      >
        {{ translationPrefix() + '.' + source() | translate }}
      </span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .source {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    /* Sin etiqueta el chip acompaña a un control que ya se nombra solo: ni fila ni separador. */
    .source--inline {
      padding: 0;
      border-bottom: none;
    }

    .source__label {
      flex: 1 1 8rem;
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .source__value {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .source__value:empty {
      display: none;
    }

    .source__chip {
      padding: 0.0625rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.6875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface-variant);
    }

    .source__chip--own {
      background: var(--app-info-container);
      color: var(--app-on-info-container);
    }
  `,
})
export class SettingSourceComponent {
  /** Nombre de lo que se está describiendo. Vacío cuando el control de al lado ya lo nombra. */
  readonly label = input<string>();

  /** El peldaño del que salió el valor, tal como lo nombra el backend. */
  readonly source = input.required<string>();

  /**
   * El peldaño que se está editando. El chip se destaca sólo cuando coincide con `source`: es la
   * diferencia entre «esto lo puse acá» y «esto lo heredé», que es la única que necesita color.
   */
  readonly ownLevel = input<string>();

  /** Namespace de i18n: `<prefix>.<SOURCE>` para la etiqueta y `<prefix>.hints.<SOURCE>` para el tooltip. */
  readonly translationPrefix = input.required<string>();

  protected readonly isOwn = computed(() => this.source() === this.ownLevel());
}
