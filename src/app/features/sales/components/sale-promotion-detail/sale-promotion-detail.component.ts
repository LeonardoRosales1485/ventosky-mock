import { Component, inject, input } from '@angular/core';
import { LanguageService } from '../../../../core/i18n/language.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { SalePromotionDetail } from '../../data-access/sale.model';

/**
 * El detalle corto de una promoción: `−10 %`, `−$500`, `3x2`.
 *
 * Existe para que la regla de cómo se escribe cada tipo viva una sola vez: la dibujan el chip de la
 * línea del carrito, el desglose del panel de totales y el del diálogo de cobro, y tres copias del
 * mismo `switch` es una donde alguien va a olvidarse del signo.
 *
 * El descriptor llega ya resuelto (`SalePromotionDetail`) y acá sólo se formatea, con el separador
 * decimal del idioma activo.
 */
@Component({
  selector: 'app-sale-promotion-detail',
  imports: [CurrencyDisplayComponent],
  template: `
    <!-- \`@let\` y no \`@switch\`: sobre la variable local el chequeador angosta la unión, así que
         cada rama llega a sus propios campos sin castear nada. -->
    @let promotion = detail();

    @if (promotion.kind === 'PERCENTAGE') {
      −{{ formatPercent(promotion.percent) }} %
    } @else if (promotion.kind === 'FIXED_AMOUNT') {
      −<app-currency-display [value]="promotion.amount" />
    } @else if (promotion.kind === 'NXM') {
      {{ promotion.buyQuantity }}x{{ promotion.payQuantity }}
    } @else {
      <!--
        Un tipo que esta versión del front no sabe describir —un cuarto que el backend sume mañana—.
        Se cae a lo que le haya dado quien la dibuja: el nombre en el chip, que si no quedaría vacío,
        y nada en el desglose, donde el nombre ya está en la fila de arriba. Inventarle un «−0 %»
        diría un número que el comprobante no va a confirmar.
      -->
      {{ fallback() }}
    }
  `,
})
export class SalePromotionDetailComponent {
  private readonly language = inject(LanguageService);

  readonly detail = input.required<SalePromotionDetail>();

  /** Qué mostrar cuando el tipo no se puede describir. Vacío deja la ranura en blanco. */
  readonly fallback = input('');

  /**
   * El porcentaje con el separador decimal del idioma activo: un 10,5 % se lee `10,5 %` en español y
   * `10.5 %` en inglés. Sin esto mostraba siempre el punto de JavaScript.
   */
  protected formatPercent(percent: number): string {
    return new Intl.NumberFormat(this.language.localeId(), {
      maximumFractionDigits: 2,
    }).format(percent);
  }
}
