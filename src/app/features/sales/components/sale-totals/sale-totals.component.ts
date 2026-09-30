import { Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { OrderTotals } from '../../../../core/pricing/order-pricing';
import { SaleBlockingReason } from '../../data-access/sale.model';
import { SalePromotionRow } from '../../state/sale-checkout';
import { SalePromotionBreakdownComponent } from '../sale-promotion-breakdown/sale-promotion-breakdown.component';

/**
 * El cierre de la venta: en qué quedaron las cuentas, el botón que abre el cobro y el que la tira.
 *
 * El botón queda habilitado aunque la venta todavía no esté para cobrarse. Apretarlo con algo sin
 * resolver contesta con la lista de lo que falta, que es una respuesta; un botón apagado, en cambio,
 * obliga a recorrer la pantalla adivinando cuál de los datos es el que traba, y en un mostrador con
 * gente esperando ese es justo el momento en que no se puede.
 */
@Component({
  selector: 'app-sale-totals',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    SalePromotionBreakdownComponent,
  ],
  templateUrl: './sale-totals.component.html',
  styleUrl: './sale-totals.component.css',
})
export class SaleTotalsComponent {
  readonly totals = input.required<OrderTotals>();

  /**
   * Promoción por promoción: lo que descontó cada una, lo que descontaría una condicionada que
   * todavía no entró, y la que se cayó. Es lo que despliega la fila «Descuento».
   */
  readonly promotions = input<readonly SalePromotionRow[]>([]);

  /**
   * Si el desglose está abierto. Arranca cerrado: lo normal es mirar el total y seguir, y el detalle
   * se abre cuando el cliente pregunta.
   */
  protected readonly breakdownOpen = signal(false);

  /**
   * Si hay algo que desplegar. Con el desglose vacío la fila sigue mostrando el importe pero no se
   * disfraza de botón: un disparador que no abre nada es peor que no tenerlo.
   */
  protected readonly hasBreakdown = computed(() => this.promotions().length > 0);

  protected onToggleBreakdown(): void {
    this.breakdownOpen.update((open) => !open);
  }

  /**
   * Lo ya cobrado. En el camino normal es cero hasta el final —los pagos se registran en el diálogo
   * y viajan directo al commit—, así que sólo aparece cuando quedó un cobro armado de un intento
   * anterior que no llegó a registrarse.
   */
  readonly paidAmount = input(0);

  readonly submitting = input(false);

  /** Cuántas líneas y cuántas unidades lleva el carrito, para el pie del bloque. */
  readonly lineCount = input(0);
  readonly unitCount = input(0);

  /**
   * Singular y plural con dos claves y no con un «(s)»: el recuento se lee de reojo mientras se
   * escanea, y «1 líneas» es de las cosas que hacen dudar de todo el número de arriba.
   *
   * Una cantidad con decimales —1,5 kg— cae siempre en el plural: el singular es exactamente uno.
   */
  protected readonly linesKey = computed(() =>
    this.lineCount() === 1 ? 'sales.totals.footLinesOne' : 'sales.totals.footLinesMany',
  );

  protected readonly unitsKey = computed(() =>
    this.unitCount() === 1 ? 'sales.totals.footUnitsOne' : 'sales.totals.footUnitsMany',
  );

  /** Si hay algo que cancelar: con el carrito vacío el botón no tiene qué tirar. */
  readonly canCancel = input(false);

  /**
   * Qué le falta a la venta para poder cobrarse. Vacío: se puede.
   *
   * Cada razón es una clave de traducción, sola o con los parámetros que la completan — «Falta
   * elegir 1 serie de …» nombra la línea que traba el cobro.
   */
  readonly missingRequirements = input<readonly SaleBlockingReason[]>([]);

  /** La tecla que abre el cobro sin pasar por el mouse. */
  readonly shortcut = input.required<string>();

  readonly charge = output<void>();

  /**
   * Tirar la venta entera y volver a empezar. La confirmación la pide la pantalla.
   *
   * `cancelSale` y no `cancel`: un output llamado como un evento nativo del DOM se dispara también
   * cuando el navegador emite el suyo, y el linter lo frena por eso.
   */
  readonly cancelSale = output<void>();

  /** La clave de una razón, sea suelta o con parámetros. */
  protected reasonKey(reason: SaleBlockingReason): string {
    return typeof reason === 'string' ? reason : reason.key;
  }

  /** Los parámetros de interpolación, o `undefined` en una razón que no los tiene. */
  protected reasonParams(reason: SaleBlockingReason): Record<string, unknown> | undefined {
    return typeof reason === 'string' ? undefined : reason.params;
  }
}
