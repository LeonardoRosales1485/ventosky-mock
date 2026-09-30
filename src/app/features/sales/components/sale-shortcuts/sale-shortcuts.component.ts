import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { SALE_SHORTCUT_HINTS } from '../../data-access/sale-shortcuts';

/**
 * La leyenda de teclas del pie de la pantalla.
 *
 * Es parte del diseño y no un apéndice. Un punto de venta se maneja sin mouse, pero nadie nace
 * sabiendo cuál es la tecla del cobro: la franja de abajo es donde se aprende, y es la razón por la
 * que a la semana el cajero ya no la mira. Cuesta una tira de alto y la paga en el primer turno.
 *
 * No es interactiva a propósito: los mismos atajos están escritos también encima de cada acción
 * —el `kbd` del botón de cobro, el del cliente, el de cada acción de la línea marcada—, así que
 * esto **repite** lo que ya se puede hacer y no es la única forma de llegar a nada.
 */
@Component({
  selector: 'app-sale-shortcuts',
  imports: [TranslatePipe],
  template: `
    <ul class="keys__list" [attr.aria-label]="'sales.keys.legendAria' | translate">
      @for (hint of hints; track hint.key) {
        <li class="keys__item">
          <kbd class="keys__key">{{ hint.key }}</kbd>
          <span class="keys__label">{{ hint.labelKey | translate }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
      flex: 0 0 auto;
      padding: 0.375rem 0.5rem 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface-variant);
    }

    .keys__list {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      /*
        Ancho de sobra: las teclas se leen en una tira. Cuando no entran, la fila que se va abajo
        arrastra su etiqueta con ella en vez de partir un atajo por la mitad.
      */
      gap: 0.25rem 1rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .keys__item {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      line-height: 1.6;
      white-space: nowrap;
    }

    .keys__key {
      padding: 0.0625rem 0.375rem;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--mat-sys-surface-container);
      font-family: inherit;
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }
  `,
  host: {
    role: 'note',
  },
})
export class SaleShortcutsComponent {
  protected readonly hints = SALE_SHORTCUT_HINTS;
}
