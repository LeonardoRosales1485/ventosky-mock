import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';

/**
 * La barra que cierra la compra: descartar lo cargado, o registrarla.
 *
 * Queda fija al pie mientras el resto de la pantalla scrollea, porque la compra se arma de arriba
 * hacia abajo —proveedor, líneas, pago— y el botón que la cierra no puede quedar a un scroll de
 * distancia del renglón que se está cargando.
 *
 * Cuando no se puede confirmar dice por qué acá mismo: un botón apagado sin motivo obliga a
 * recorrer la pantalla buscando qué falta.
 */
@Component({
  selector: 'app-purchase-action-bar',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './purchase-action-bar.component.html',
  styleUrl: './purchase-action-bar.component.css',
})
export class PurchaseActionBarComponent {
  readonly totalAmount = input.required<number>();

  /**
   * Con qué texto cierra. No siempre se está registrando una compra: contra un comprobante sin
   * efectos lo que se emite es una orden al proveedor, y el botón tiene que decir eso.
   */
  readonly confirmLabelKey = input('purchases.totals.confirm');

  readonly canConfirm = input.required<boolean>();
  readonly submitting = input(false);

  /** Si hay algo cargado que descartar. Con la pantalla en blanco, cancelar no hace nada. */
  readonly canDiscard = input(false);

  /** Clave de traducción con el motivo por el que no se puede confirmar; `null` si se puede. */
  readonly blockedReasonKey = input<string | null>(null);

  /** Descartar lo cargado. No se llama `cancel`: chocaría con el evento nativo del DOM. */
  readonly discard = output<void>();
  readonly confirm = output<void>();
}
