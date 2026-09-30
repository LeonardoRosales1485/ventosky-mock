import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { OrderReceiver } from '../../../../core/orders/order-commit.model';
import { AccountAvailabilityDto } from '../../../../core/checking-accounts/account-availability.model';
import { SaleCustomerDto, SalePaymentMethodDto } from '../../data-access/sale.model';
import { SalePayment, paymentBalance } from '../../state/direct-sale-cart';
import { SalePromotionContext, saleCheckoutOf } from '../../state/sale-checkout';
import { NewSalePayment, SalePaymentsComponent } from '../sale-payments/sale-payments.component';
import { SalePromotionBreakdownComponent } from '../sale-promotion-breakdown/sale-promotion-breakdown.component';
import { SaleReceiverComponent } from '../sale-receiver/sale-receiver.component';

export interface SalePaymentDialogData {
  paymentMethods: readonly SalePaymentMethodDto[];
  /**
   * La venta a evaluar, **sin los pagos**: líneas, promociones y las condiciones contra las que se
   * filtran. Los pagos los pone el diálogo con los suyos, que es lo que hace que el total se mueva
   * acá adentro sin tocar el carrito.
   *
   * Viaja el contexto y no los totales ya calculados porque con una promoción condicionada por medio
   * de pago **el total depende de con qué se paga**: un número congelado al abrir el diálogo dejaría
   * de ser cierto en cuanto se cargue el primer tramo.
   */
  promotionContext: SalePromotionContext;
  /**
   * Con qué pagos arranca. Normalmente ninguno; trae los de antes cuando se vuelve a abrir después
   * de un commit que falló, para no obligar a rearmar un cobro que ya estaba bien.
   */
  payments: readonly SalePayment[];
  /** El cliente de la venta, si hay. De su ficha se precarga el receptor del comprobante. */
  customer: SaleCustomerDto | null;
  /** El receptor ya editado, cuando se vuelve a abrir el diálogo. `null` = todavía nadie lo tocó. */
  receiver: OrderReceiver | null;
  /**
   * El estado de la cuenta corriente del cliente, ya resuelto por el backend. `null` sin cliente, o
   * cuando no se pudo leer.
   *
   * Es lo que hace que el medio «cuenta corriente» sepa qué ofrecer: con él precarga el disponible
   * y deja el resto para otro medio, en vez de dejar tipear un importe que el commit va a rechazar.
   */
  availability: AccountAvailabilityDto | null;
}

/**
 * Con qué se cierra la venta: los pagos y a nombre de quién se emite. Cerrar sin confirmar no
 * devuelve nada.
 */
export interface SalePaymentDialogResult {
  payments: readonly SalePayment[];
  receiver: OrderReceiver | null;
}

/**
 * El paso del cobro: en qué medios y por cuánto se paga la venta.
 *
 * Vive en un diálogo y no en la pantalla porque es un momento y no un estado: mientras se arma el
 * carrito, el cobro no existe todavía, y el panel de la derecha rendía mejor mostrando la venta que
 * un formulario que no se va a tocar hasta el final. Además fuerza el orden correcto —primero está
 * la venta, después se cobra—, que es el que evita cobrar algo que después no se puede emitir.
 *
 * Los pagos se arman acá adentro y sólo salen al confirmar: cancelar deja la venta como estaba, sin
 * un cobro a medias colgado del carrito.
 */
@Component({
  selector: 'app-sale-payment-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    SalePaymentsComponent,
    SalePromotionBreakdownComponent,
    SaleReceiverComponent,
  ],
  templateUrl: './sale-payment-dialog.component.html',
  styleUrl: './sale-payment-dialog.component.css',
})
export class SalePaymentDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<SalePaymentDialogComponent, SalePaymentDialogResult>>(MatDialogRef);

  protected readonly data = inject<SalePaymentDialogData>(MAT_DIALOG_DATA);

  protected readonly payments = signal<readonly SalePayment[]>(this.data.payments);

  /**
   * A nombre de quién se emite. Vive acá y no en la pantalla porque el receptor es del
   * **comprobante**, y el comprobante se emite en este paso: mientras se arma el carrito todavía no
   * hay nada que emitir.
   */
  protected readonly receiver = signal<OrderReceiver | null>(this.data.receiver);

  /**
   * La venta re-evaluada con los pagos que se están cargando acá. Cada alta y cada baja la recalcula:
   * si los medios cumplen la condición el descuento entra y el total baja; si entra un pago con un
   * medio ajeno, la promoción se cae y el total vuelve a subir.
   *
   * Es la **misma función** que corre el carrito: si cada lado calculara su total, el diálogo podría
   * dar por saldado un cobro que el carrito rechaza.
   */
  protected readonly checkout = computed(() =>
    saleCheckoutOf(
      this.data.promotionContext,
      this.payments().map((payment) => payment.paymentMethod.uuid),
    ),
  );

  protected readonly totals = computed(() => this.checkout().totals);

  /** La misma cuenta que hace el carrito, con la misma tolerancia: no pueden discrepar. */
  protected readonly balance = computed(() =>
    paymentBalance(this.totals().totalAmount, this.payments()),
  );

  protected onPaymentAdd(payment: NewSalePayment): void {
    this.payments.update((payments) => [
      ...payments,
      { paymentMethod: payment.paymentMethod, amount: payment.amount },
    ]);
  }

  protected onPaymentRemove(index: number): void {
    this.payments.update((payments) => payments.filter((_, position) => position !== index));
  }

  protected onConfirm(): void {
    if (!this.balance().isFullyPaid) {
      return;
    }

    this.dialogRef.close({ payments: this.payments(), receiver: this.receiver() });
  }
}
