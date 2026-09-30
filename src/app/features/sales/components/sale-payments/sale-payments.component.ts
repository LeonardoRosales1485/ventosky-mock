import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import {
  ACCOUNT_DISABLED,
  AccountAvailabilityDto,
} from '../../../../core/checking-accounts/account-availability.model';
import { SalePaymentMethodDto } from '../../data-access/sale.model';
import { SalePayment } from '../../state/direct-sale-cart';

/** Un tramo del cobro, listo para sumarse al checkout. */
export interface NewSalePayment {
  paymentMethod: SalePaymentMethodDto;
  amount: number;
}

/** `PaymentMethod.code` del medio «cuenta corriente», el único que consume el disponible. */
const ACCOUNT_METHOD_CODE = 'ACCOUNT';

/**
 * El cobro de la venta, que puede repartirse en varios medios: parte con tarjeta, el resto en
 * efectivo, un tramo a cuenta corriente.
 *
 * El monto del tramo nuevo arranca en lo que falta cobrar y sigue cambiando con el saldo mientras
 * el operador no lo toque: el caso frecuente —un solo medio que paga todo— se resuelve eligiendo el
 * medio y apretando agregar, sin escribir el importe. Desde el importe, el Enter agrega el tramo:
 * el cobro se arma sin soltar el teclado.
 *
 * **La cuenta corriente es el único medio con techo.** Al elegirlo, el importe propuesto baja del
 * total al disponible que resolvió el backend, y el resto queda para otro medio (§10.1). Es la
 * diferencia entre un cobro que se arma solo y un «no se puede» a secas, que manda al cajero a
 * llamar por teléfono. El disponible **no se recalcula acá**: llega decidido.
 *
 * Lo que sí deshabilita el medio es que la cuenta esté deshabilitada, con el motivo a la vista.
 * Ninguno de los cuatro niveles de morosidad lo hace — el chip informa y no interrumpe.
 */
@Component({
  selector: 'app-sale-payments',
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
  templateUrl: './sale-payments.component.html',
  styleUrl: './sale-payments.component.css',
})
export class SalePaymentsComponent {
  readonly paymentMethods = input.required<readonly SalePaymentMethodDto[]>();
  readonly payments = input.required<readonly SalePayment[]>();

  /** Lo que falta cobrar. Es el valor con el que se propone el importe del tramo nuevo. */
  readonly remainingAmount = input.required<number>();

  /**
   * El estado de la cuenta corriente del titular, ya resuelto por el backend. `null` sin titular, o
   * cuando no se pudo leer — y en ese caso el medio se ofrece sin techo y quien decide es el commit.
   */
  readonly availability = input<AccountAvailabilityDto | null>(null);

  readonly disabled = input(false);

  readonly paymentAdd = output<NewSalePayment>();
  readonly paymentRemove = output<number>();

  protected readonly selectedMethodUuid = signal<string | null>(null);

  protected readonly selectedMethod = computed(
    () =>
      this.paymentMethods().find((method) => method.uuid === this.selectedMethodUuid()) ?? null,
  );

  /** Si el medio elegido es el de cuenta corriente, que es el único con techo. */
  protected readonly isAccountMethod = computed(
    () => this.selectedMethod()?.code?.toUpperCase() === ACCOUNT_METHOD_CODE,
  );

  /**
   * La cuenta apagada, que es lo único que deshabilita el medio (§9.2).
   *
   * El motivo se dice al lado y no sólo se pinta la opción en gris: un desplegable con una opción
   * apagada y sin explicación manda al cajero a preguntar por qué.
   */
  protected readonly accountDisabled = computed(
    () => this.availability()?.blockedReason === ACCOUNT_DISABLED,
  );

  /**
   * Cuánto se puede llevar a cuenta, o `null` cuando no hay techo —otro medio, sin tope configurado,
   * sin titular, o sin respuesta del backend—.
   *
   * Cero es un techo y no una ausencia: significa que el medio se puede elegir pero no queda nada
   * disponible, y el formulario dice eso en vez de proponer el total.
   */
  protected readonly accountCap = computed<number | null>(() =>
    this.isAccountMethod() ? (this.availability()?.available ?? null) : null,
  );

  /**
   * Se reinicia con el saldo pendiente cada vez que este cambia —al agregar una línea, al quitar un
   * pago, al elegir un medio con techo— y conserva lo tipeado hasta entonces: el operador puede
   * cobrar un monto parcial distinto sin que la pantalla se lo pise sola.
   *
   * Con la cuenta corriente elegida propone el disponible en vez del total, y el resto queda para
   * otro medio. Es lo que convierte un rechazo en un cobro dividido.
   */
  protected readonly draftAmount = linkedSignal<
    { remaining: number; cap: number | null },
    number | null
  >({
    source: () => ({ remaining: this.remainingAmount(), cap: this.accountCap() }),
    computation: ({ remaining, cap }) => {
      const proposed = cap === null ? remaining : Math.min(remaining, cap);
      return proposed > 0 ? roundToCents(proposed) : null;
    },
  });

  protected readonly canAdd = computed(() => {
    const amount = this.draftAmount();
    if (this.disabled() || this.selectedMethod() === null || amount === null || amount <= 0) {
      return false;
    }

    // Con la cuenta apagada no hay nada que agregar: el commit lo rechazaría igual, y dejar armar
    // el tramo para después borrarlo es hacer trabajo que se va a tirar.
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
}

/** Los importes de un cobro son pesos y centavos: nadie cobra fracciones de centavo. */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
