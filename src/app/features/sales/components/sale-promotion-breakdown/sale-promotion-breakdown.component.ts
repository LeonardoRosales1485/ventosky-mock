import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { SalePromotionRow } from '../../state/sale-checkout';
import { SalePromotionDetailComponent } from '../sale-promotion-detail/sale-promotion-detail.component';

/**
 * Promoción por promoción: cuánto descontó cada una, cuál se está ofreciendo y cuál se cayó.
 *
 * Lo dibujan los dos lugares donde el vendedor necesita contestar «¿por qué me sale esto?»: el panel
 * de totales mientras arma el carrito, y el diálogo de cobro, donde el total se mueve con cada tramo
 * que se carga. Es un solo componente porque es una sola lista: si cada pantalla dibujara la suya,
 * la promoción caída podría quedar tachada en una y desaparecer de la otra.
 *
 * Los tres estados se dibujan distinto porque prometen distinto (ver {@link SalePromotionRow}): la
 * aplicada es plata, la sugerida es algo que todavía no pasó —punteada y en condicional, para no
 * prometer un descuento que no está— y la caída queda tachada en $0 con qué hacer para recuperarla.
 */
@Component({
  selector: 'app-sale-promotion-breakdown',
  imports: [TranslatePipe, CurrencyDisplayComponent, SalePromotionDetailComponent],
  templateUrl: './sale-promotion-breakdown.component.html',
  styleUrl: './sale-promotion-breakdown.component.css',
})
export class SalePromotionBreakdownComponent {
  readonly promotions = input.required<readonly SalePromotionRow[]>();
}
