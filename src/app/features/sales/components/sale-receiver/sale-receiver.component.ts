import { Component, computed, effect, input, model, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { OrderReceiver, RECEIVER_DOCUMENT_TYPES } from '../../../../core/orders/order-commit.model';
import { SaleCustomerDto } from '../../data-access/sale.model';

/**
 * A quién se le emite el comprobante.
 *
 * **No es el cliente.** El cliente es con quién opera el mostrador; el receptor es lo que se
 * imprime, y el backend lo congela en la orden al emitir. Que sean dos cosas distintas es lo que
 * permite dos casos que el maestro no puede representar: vender sin ficha pero registrando el
 * documento del comprador —el umbral de identificación—, y que un cliente registrado pida la
 * factura a otro CUIT.
 *
 * Con cliente elegido los campos **se precargan de su ficha y se pueden pisar**. Editar acá no toca
 * el maestro: no crea ni modifica ningún tercero.
 */
@Component({
  selector: 'app-sale-receiver',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
  ],
  templateUrl: './sale-receiver.component.html',
  styleUrl: './sale-receiver.component.css',
})
export class SaleReceiverComponent {
  /** El cliente de la venta, si hay. De su ficha sale la precarga. */
  readonly customer = input<SaleCustomerDto | null>(null);

  /**
   * El receptor. `null` mientras nadie lo tocó, y en ese caso el commit no manda el bloque: lo
   * resuelve el backend copiando la ficha del cliente. Se vuelve un objeto en cuanto se edita algo.
   */
  readonly receiver = model<OrderReceiver | null>(null);

  protected readonly documentTypes = RECEIVER_DOCUMENT_TYPES;

  /** `true` cuando el operador abrió el bloque para editarlo, o cuando ya venía editado. */
  protected readonly editing = signal(false);

  /**
   * Lo que se muestra: lo editado si lo hay, y si no la ficha del cliente. Es sólo presentación —
   * mientras {@link receiver} siga en `null` no viaja nada y el backend hace exactamente la misma
   * copia, así que precargar no cambia lo que se emite.
   */
  protected readonly shown = computed<OrderReceiver>(() => {
    const edited = this.receiver();
    if (edited) {
      return edited;
    }

    const customer = this.customer();
    if (!customer) {
      return {};
    }

    return {
      receiverName: customer.name,
      receiverDocType: customer.docType ?? undefined,
      receiverDocNumber: customer.docNumber ?? undefined,
      receiverTaxCondition: customer.taxCondition ?? undefined,
    };
  });

  /** Sin cliente y sin nada tipeado, el comprobante sale a consumidor final. Conviene decirlo. */
  protected readonly isFinalConsumer = computed(
    () => !this.customer() && !hasAnyValue(this.receiver()),
  );

  constructor() {
    // Un receptor que llega ya editado —el diálogo que se reabre tras un commit fallido— abre el
    // bloque solo: esconder lo que alguien escribió sería perderlo de vista sin haberlo borrado.
    effect(() => {
      if (hasAnyValue(this.receiver())) {
        this.editing.set(true);
      }
    });
  }

  protected onEdit(): void {
    // Al abrir, lo mostrado pasa a ser lo editado: a partir de acá el bloque viaja en el commit,
    // aunque no se cambie ni una letra. Es la contrapartida de que el backend lo trate como un
    // todo — media edición sobre la ficha del cliente sería un receptor que nunca existió.
    this.receiver.set({ ...this.shown() });
    this.editing.set(true);
  }

  protected onFieldChange(field: keyof OrderReceiver, value: string): void {
    const trimmed = value.trim();
    const next: OrderReceiver = { ...this.shown(), [field]: trimmed || undefined };
    this.receiver.set(hasAnyValue(next) ? next : null);
  }

  /** Vuelve a la ficha del cliente, o a consumidor final si no hay. */
  protected onReset(): void {
    this.receiver.set(null);
    this.editing.set(false);
  }
}

function hasAnyValue(receiver: OrderReceiver | null): boolean {
  if (!receiver) {
    return false;
  }

  return Object.values(receiver).some((value) => typeof value === 'string' && value.trim() !== '');
}
