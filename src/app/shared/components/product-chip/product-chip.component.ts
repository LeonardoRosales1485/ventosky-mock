import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ProductChip } from './product-chip';

/**
 * Un chip de producto, dibujado siempre igual: la grilla del catálogo y la línea de un comprobante
 * del histórico comparten esta pieza, así que «discontinuado» se ve idéntico en las dos.
 *
 * No decide nada —recibe el chip ya resuelto— y por eso vive en `shared/`: la regla de qué producto
 * merece qué chip es del dominio que lo llama.
 *
 * **Con `link` se dibuja como enlace.** Es lo que hace que el indicador del histórico lleve a la
 * ficha: un chip que marca un producto retirado y no se puede seguir deja a quien lo lee sin nada
 * que hacer con la marca. Es un `<a>` de verdad y no un `<span>` con `(click)` para que entre en el
 * orden de tabulación, se abra en otra pestaña y lo anuncie el lector de pantalla — y por eso
 * `linkLabel` es obligatorio ahí: «Archivado» solo, leído fuera de la fila, no dice adónde lleva.
 */
@Component({
  selector: 'app-product-chip',
  imports: [RouterLink, TranslatePipe],
  template: `
    @let text = chip().labelKey | translate: chip().params;

    @if (link(); as target) {
      <a
        class="chip chip--link"
        [attr.data-chip]="chip().id"
        [routerLink]="target"
        [attr.aria-label]="linkLabel()"
      >
        {{ text }}
      </a>
    } @else {
      <span class="chip" [attr.data-chip]="chip().id">{{ text }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      max-width: 100%;
    }

    /* Propuesta B: pill de 20px junto al nombre del producto. */
    .chip {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 7px;
      border-radius: 999px;
      background: var(--vk-sunken);
      color: var(--vk-fg-2);
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
    }

    /*
      El enlace es un destino táctil, no un pedazo de texto en una oración: lleva las 24×24 CSS px
      que pide WCAG 2.2 (SC 2.5.8, AA), que el chip informativo de 20 px de alto no alcanzaba.
    */
    .chip--link {
      display: inline-flex;
      align-items: center;
      min-height: 1.5rem;
      padding-inline: 0.5rem;
      text-decoration: none;
      text-underline-offset: 0.125rem;
      cursor: pointer;
    }

    /*
      El foco se dibuja sobre el chip y no sobre la celda: es el único elemento enfocable de la fila.
      Va en currentColor y no en el color primario porque cada chip tiene su fondo —el archivado
      invierte el tema— y sólo su propio color de texto tiene contraste garantizado contra él
      (SC 1.4.11). El halo de afuera, del color de la superficie, lo despega del fondo de la celda.
    */
    .chip--link:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
      box-shadow: 0 0 0 4px var(--mat-sys-surface);
    }

    /*
      Archivado y discontinuado son los dos chips de **estado**, y el ticket pide que se distingan
      entre sí: uno se deshace y el otro no (ADR 0001). El archivado va con el par invertido —el
      contraste más alto que da el tema, y el único que no se confunde con ninguna otra etiqueta de
      la fila— y el discontinuado con el error atenuado que ya usaba el catálogo. Los dos son pares
      de Material, así que el contraste AA lo garantiza el tema en claro y en oscuro.
    */
    .chip[data-chip='archived'] {
      background: var(--vk-side);
      color: #fff;
    }

    .chip[data-chip='discontinued'] {
      background: var(--vk-bad-soft);
      color: var(--vk-bad);
    }

    /* Qué es el producto: lo que cambia cómo se vende, no cómo se cuenta. */
    .chip[data-chip='kit'],
    .chip[data-chip='kitAssembled'],
    .chip[data-chip='service'] {
      background: var(--vk-accent-soft);
      color: var(--vk-on-accent-soft);
    }

    .chip[data-chip='weighable'] {
      background: var(--vk-warn-soft);
      color: var(--vk-warn);
    }

    /* El vencimiento es lo único que caduca solo: es la advertencia de la fila, no una etiqueta más. */
    .chip[data-chip='expires'] {
      background: var(--vk-bad-soft);
      color: var(--vk-bad);
    }
  `,
})
export class ProductChipComponent {
  readonly chip = input.required<ProductChip>();

  /** Adónde lleva el chip, o `null` si sólo informa. Es un `routerLink`, no una URL externa. */
  readonly link = input<string | readonly unknown[] | null>(null);

  /** El nombre accesible del enlace, ya traducido. Sin él el chip enlazado se lee «Archivado». */
  readonly linkLabel = input<string | null>(null);
}
