import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ACCOUNT_DISABLED,
  AccountAvailabilityDto,
} from '../../../../core/checking-accounts/account-availability.model';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PurchasePaymentMethodDto } from '../../data-access/purchase.model';
import { PurchasePayment } from '../../state/purchase-cart';

/** Un tramo del pago, listo para sumarse al checkout. */
export interface NewPurchasePayment {
  paymentMethod: PurchasePaymentMethodDto;
  amount: number;
}

/** `PaymentMethod.code` del medio «cuenta corriente». */
const ACCOUNT_METHOD_CODE = 'ACCOUNT';

/**
 * El pago de la compra, que puede repartirse en varios medios: una parte en efectivo, el resto a la
 * cuenta corriente del proveedor.
 *
 * El monto del tramo nuevo arranca en lo que falta pagar y sigue cambiando con el saldo mientras el
 * operador no lo toque: el caso frecuente —un solo medio que cubre todo— se resuelve eligiendo el
 * medio y apretando agregar, sin escribir el importe.
 *
 * **La cuenta del proveedor no tiene techo, y por eso acá no hay disponible ni límite** (§10.1):
 * cuánto nos fía lo decide él, y si ya despachó la mercadería la deuda existe — negarnos a
 * registrarla no la hace desaparecer. Lo único que deshabilita el medio es que la cuenta esté
 * deshabilitada, y eso se dice con su motivo.
 *
 * Gemelo de `SalePaymentsComponent` (`features/sales`): el cobro de una venta y el pago de una
 * compra se arman igual, y lo único que cambia es de qué raíz de i18n salen los textos y que la
 * venta sí tiene un disponible que proponer. Si se toca uno, mirar el otro.
 */
@Component({
  selector: 'app-purchase-payments',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './purchase-payments.component.html',
  styleUrl: './purchase-payments.component.css',
})
export class PurchasePaymentsComponent {
  readonly paymentMethods = input.required<readonly PurchasePaymentMethodDto[]>();
  readonly payments = input.required<readonly PurchasePayment[]>();

  /** Lo que falta pagar. Es el valor con el que se propone el importe del tramo nuevo. */
  readonly remainingAmount = input.required<number>();

  /**
   * El estado de la cuenta corriente del proveedor, ya resuelto por el backend. Llega sin límite ni
   * disponible —se pregunta como `PURCHASE`— y lo único que la pantalla mira es si está apagada.
   */
  readonly availability = input<AccountAvailabilityDto | null>(null);

  readonly disabled = input(false);

  readonly paymentAdd = output<NewPurchasePayment>();
  readonly paymentRemove = output<number>();

  protected readonly selectedMethodUuid = signal<string | null>(null);

  /**
   * Se reinicia con el saldo pendiente cada vez que este cambia —al agregar una línea, al quitar un
   * pago— y conserva lo tipeado hasta entonces: el operador puede registrar un pago parcial distinto
   * sin que la pantalla se lo pise sola.
   */
  protected readonly draftAmount = linkedSignal<number, number | null>({
    source: () => this.remainingAmount(),
    computation: (remaining) => (remaining > 0 ? roundToCents(remaining) : null),
  });

  protected readonly selectedMethod = computed(
    () => this.paymentMethods().find((method) => method.uuid === this.selectedMethodUuid()) ?? null,
  );

  /** Si el medio elegido es el de cuenta corriente del proveedor. */
  protected readonly isAccountMethod = computed(
    () => this.selectedMethod()?.code?.toUpperCase() === ACCOUNT_METHOD_CODE,
  );

  /** La cuenta apagada. Es lo único que deshabilita el medio, también del lado de la compra. */
  protected readonly accountDisabled = computed(
    () => this.availability()?.blockedReason === ACCOUNT_DISABLED,
  );

  protected readonly canAdd = computed(() => {
    const amount = this.draftAmount();
    if (this.disabled() || this.selectedMethod() === null || amount === null || amount <= 0) {
      return false;
    }

    return !(this.isAccountMethod() && this.accountDisabled());
  });

  protected onAmountInput(value: string): void {
    const amount = Number.parseFloat(value);
    this.draftAmount.set(Number.isNaN(amount) ? null : amount);
  }

  protected onAdd(): void {
    const method = this.selectedMethod();
    const amount = this.draftAmount();
    // La misma regla que deshabilita el botón, porque el Enter desde el importe no pasa por él.
    if (!method || amount === null || amount <= 0 || !this.canAdd()) {
      return;
    }

    this.paymentAdd.emit({ paymentMethod: method, amount: roundToCents(amount) });
    this.selectedMethodUuid.set(null);
  }

  /** Ícono del medio por su nombre: el catálogo no trae uno propio. */
  protected methodIcon(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('transfer') || n.includes('banc')) return 'account_balance';
    if (n.includes('tarjeta') || n.includes('crédito') || n.includes('débito')) return 'credit_card';
    if (n.includes('cuenta')) return 'account_balance_wallet';
    if (n.includes('cheque')) return 'receipt_long';
    return 'payments';
  }
}

/** Los importes de un pago son pesos y centavos: nadie paga fracciones de centavo. */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
