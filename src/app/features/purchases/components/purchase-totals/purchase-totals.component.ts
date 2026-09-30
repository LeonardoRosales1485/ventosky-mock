import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { OrderTotals } from '../../../../core/pricing/order-pricing';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';

/**
 * El resumen de la compra: en qué quedaron las cuentas.
 *
 * Sólo informa. El botón que cierra la operación vive en la barra de acciones
 * (`app-purchase-action-bar`), fija al pie: el resumen se lee una vez y el botón tiene que estar a
 * mano desde cualquier punto del scroll.
 *
 * Los importes son una **anticipación** de los del backend (ver `core/pricing/order-pricing.ts`):
 * los definitivos son los que devuelve el commit.
 */
@Component({
  selector: 'app-purchase-totals',
  imports: [MatIconModule, TranslatePipe, CurrencyDisplayComponent],
  templateUrl: './purchase-totals.component.html',
  styleUrl: './purchase-totals.component.css',
})
export class PurchaseTotalsComponent {
  readonly totals = input.required<OrderTotals>();

  /** Lo que falta pagar; `<= 0` significa que los pagos ya cubren el total. */
  readonly remainingAmount = input.required<number>();

  /** Lo pagado de más, si el reparto entre medios se pasó del total. */
  readonly changeAmount = input.required<number>();

  /**
   * Si el comprobante registra pago. Con uno que no lo hace —una orden de compra— no hay saldo
   * pendiente que mostrar: no hay nada que pagar todavía.
   */
  readonly requiresPayment = input(true);

  protected readonly hasRemaining = computed(
    () => this.requiresPayment() && this.remainingAmount() > 0.005,
  );

  protected readonly hasChange = computed(() => this.requiresPayment() && this.changeAmount() > 0);
}
