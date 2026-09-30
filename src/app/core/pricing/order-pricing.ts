/**
 * Las mismas cuentas que hace el backend al cerrar una compra o una venta, replicadas para poder
 * mostrar el carrito **antes** del commit.
 *
 * El número que vale es siempre el que devuelve `POST /order/commit`: acá no se decide nada, sólo
 * se anticipa. Por eso el redondeo y el orden de las operaciones copian a `OrderItemBuilderService`
 * al pie de la letra — si divergen, la pantalla miente sobre el total que se está por cerrar.
 *
 * Sirve igual a las dos operaciones porque el backend las calcula igual: lo único que cambia es de
 * dónde sale el `unitPrice` —la lista de precios en venta, el costo que escribe el operador en
 * compra—, y para cuando llega acá ya está resuelto.
 */

import { PriceRounding, roundAmount } from './price-rounding';

/**
 * Importes de una línea, en el mismo orden en que los calcula `OrderItemBuilderService`.
 *
 * Los tres importes viajan **ya netos de promociones**: el motor descuenta sobre el neto y prorratea
 * el impuesto con el mismo factor, así que la línea que llega acá es la que se cobra. Lo que las
 * promociones restaron viaja aparte en {@link discountAmount}, que es lo único que el checkout
 * necesita para mostrar el descuento sin volver a calcularlo.
 */
export interface LineAmounts {
  /** Precio unitario ya redondeado: es el que multiplica, no el de la lista. */
  unitPrice: number;
  /** Lo que las promociones le restaron al neto; `0` en una línea que ninguna alcanza. */
  discountAmount: number;
  /** Base imponible de la línea, ya descontada y sin impuesto. */
  netAmount: number;
  taxAmount: number;
  /** Con impuesto incluido: es el `subtotal` que persiste el backend. */
  subtotal: number;
}

/**
 * Los importes de lista, **antes** de promociones: es el paso que el backend hace primero y el que
 * el motor toma como entrada. Para la línea que una promoción alcanza, el resultado se corrige con
 * `withPromotionDiscount`.
 *
 * @param rounding Criterio de la **regla de precio** que alcanza al producto en la sucursal
 *   (`v74`/`v75`). Sin regla resuelta, los defaults del enum: dos decimales al más cercano.
 * @param addsTax Lo declara el **comprobante** (`vouchers.adds_tax`), no el producto: una factura A
 *   discrimina el IVA y lo suma al neto; una B o una C cobran el importe de la lista sin agregar
 *   nada. La alícuota del producto se registra igual en la línea, se aplique o no.
 */
export function computeLineAmounts(
  unitPrice: number,
  quantity: number,
  taxRate: number,
  rounding: PriceRounding,
  addsTax: boolean,
): LineAmounts {
  const roundedUnitPrice = roundAmount(unitPrice, rounding);
  const netAmount = roundedUnitPrice * quantity;
  const taxAmount = addsTax ? roundAmount(netAmount * (taxRate / 100), rounding) : 0;

  return {
    unitPrice: roundedUnitPrice,
    discountAmount: 0,
    netAmount,
    taxAmount,
    subtotal: roundAmount(netAmount + taxAmount, rounding),
  };
}

/**
 * Totales del checkout: la suma de las líneas, sin redondeo extra encima.
 *
 * `discountAmount` es **sólo el de las líneas**. El descuento de ámbito `ORDER_TOTAL` lo resuelve el
 * motor sobre la suma de subtotales y no pasa por acá.
 */
export interface OrderTotals {
  netAmount: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
}

export function sumTotals(lines: readonly LineAmounts[]): OrderTotals {
  const totals: OrderTotals = { netAmount: 0, taxAmount: 0, discountAmount: 0, totalAmount: 0 };

  for (const line of lines) {
    totals.netAmount += line.netAmount;
    totals.taxAmount += line.taxAmount;
    totals.discountAmount += line.discountAmount;
    totals.totalAmount += line.subtotal;
  }

  return totals;
}
