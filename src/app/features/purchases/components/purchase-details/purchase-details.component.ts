import { Component, computed, input, output } from '@angular/core';
import { formatDocument } from '../../../../core/parties/party.model';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { toLocalDateTimeInput } from '../../../../core/orders/local-date-time';
import { ORDER_OBSERVATIONS_MAX_LENGTH } from '../../../../core/orders/order-commit.model';
import {
  PurchaseSupplierDto,
  PurchaseVoucherDto,
  addsTax,
  requiresPayment,
} from '../../data-access/purchase.model';

/**
 * El encabezado de la compra: a quién se le compra, con qué comprobante, con qué fecha y qué hay
 * para anotar.
 *
 * Va arriba y no al costado porque es lo que se decide **antes** de cargar la primera línea: el
 * comprobante define si el stock entra, si el IVA se discrimina y si la operación se paga, así que
 * elegirlo después sería recalcular la compra ya cargada.
 *
 * Es sólo presentación: no toca el carrito, avisa qué eligió el operador.
 */
@Component({
  selector: 'app-purchase-details',
  imports: [MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, TranslatePipe],
  templateUrl: './purchase-details.component.html',
  styleUrl: './purchase-details.component.css',
})
export class PurchaseDetailsComponent {
  /** El documento del proveedor tal como se lee en la opción del select. */
  protected readonly formatDocument = formatDocument;

  readonly suppliers = input.required<readonly PurchaseSupplierDto[]>();
  readonly vouchers = input.required<readonly PurchaseVoucherDto[]>();

  readonly supplier = input<PurchaseSupplierDto | null>(null);
  readonly voucher = input<PurchaseVoucherDto | null>(null);

  readonly dateOperation = input.required<Date>();

  /** La nota de la compra (`observations` del commit). */
  readonly observations = input('');

  /** `true` si la fecha elegida cae hoy: de eso depende qué sesión de caja puede cubrirla. */
  readonly isToday = input(true);

  readonly disabled = input(false);

  /**
   * Bloquea el proveedor. Es la edición de una orden ya emitida: `POST /order/{uuid}/convert` no
   * deja cambiarlo —responde 400—, así que ofrecerlo sería ofrecer un error. Cambiar de proveedor es
   * emitir otra orden.
   */
  readonly supplierLocked = input(false);

  readonly supplierChange = output<string>();
  readonly voucherChange = output<string>();
  readonly dateOperationChange = output<string>();
  readonly observationsChange = output<string>();

  protected readonly maxLength = ORDER_OBSERVATIONS_MAX_LENGTH;

  /**
   * Las opciones del select de proveedor.
   *
   * Con el proveedor bloqueado es exactamente uno —el de la orden—, y no el catálogo: ofrecer los
   * demás sugeriría un cambio que el backend rechaza, y además el de la orden puede no estar en la
   * lista (dado de baja, o el usuario sin permiso para listarlo), con lo que el campo quedaría
   * mostrando vacío el dato que justamente no se puede tocar.
   */
  protected readonly supplierOptions = computed<readonly PurchaseSupplierDto[]>(() => {
    const locked = this.supplierLocked() ? this.supplier() : null;

    return locked ? [locked] : this.suppliers();
  });

  /** El valor con el que se pinta el campo: `YYYY-MM-DDTHH:mm` en hora local, sin `Z`. */
  protected readonly dateOperationValue = computed(() =>
    toLocalDateTimeInput(this.dateOperation()),
  );

  /** Qué va a hacer el comprobante elegido, para decirlo antes de cargar y no después de cerrar. */
  protected readonly incrementsStock = computed(() => this.voucher()?.stockEffect === 'INCREMENT');
  protected readonly addsTax = computed(() => addsTax(this.voucher()));
  protected readonly requiresPayment = computed(() => requiresPayment(this.voucher()));
}
