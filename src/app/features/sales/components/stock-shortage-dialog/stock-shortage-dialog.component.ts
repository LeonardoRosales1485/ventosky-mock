import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { StockShortageDetail, StockValidationPolicy } from '../../../../core/orders/order-commit.model';

export interface StockShortageDialogData {
  shortages: readonly StockShortageDetail[];
  /**
   * La política que produjo estos faltantes. `STRICT_BLOCK` no admite confirmación: el único
   * camino es ajustar el carrito.
   *
   * `null` es la política que no se pudo leer. El diálogo entonces **ofrece confirmar**: si el
   * backend la va a rechazar igual, lo dirá el commit; tratarla como bloqueante frenaría una venta
   * que la sucursal permite, y ése es el error caro de los dos.
   */
  policy: StockValidationPolicy | null;
}

/** Qué hacer con el faltante: cerrar igual, o volver al carrito a corregir las cantidades. */
export type StockShortageDialogResult = 'confirm' | 'adjust';

/**
 * El detalle de los productos que no llegan a cubrir lo pedido, y la decisión que le corresponde al
 * operador.
 *
 * Se abre en dos momentos y por la misma razón, con la diferencia de quién detectó el faltante:
 *
 * - **Antes del commit**, cuando la sucursal es `STRICT_BLOCK` y el `totalStock` del carrito ya no
 *   alcanza. Ahí no hay nada que confirmar —el backend rechazaría con 400— así que la única salida
 *   es ajustar. Se anticipa porque ese 400 no trae el detalle estructurado y la pantalla sí lo tiene.
 * - **Después del 409**, cuando la sucursal es `WARNING_CONFIRMATION` y el backend devolvió los
 *   faltantes exactos. Confirmar reenvía el commit con `confirmStockOverride: true`.
 *
 * `FORCE_SALE` nunca llega acá: esa sucursal vende en negativo sin avisar.
 */
@Component({
  selector: 'app-stock-shortage-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    TranslatePipe,
  ],
  templateUrl: './stock-shortage-dialog.component.html',
  styleUrl: './stock-shortage-dialog.component.css',
})
export class StockShortageDialogComponent {
  protected readonly data = inject<StockShortageDialogData>(MAT_DIALOG_DATA);

  protected readonly isBlocking = computed(() => this.data.policy === 'STRICT_BLOCK');
}
