import { round2 } from '../pricing/decimals';
import { OrderDto, OrderPromotionDto } from './order-commit.model';

/**
 * Una promoción aplicada, ya resuelta para la tabla: la fila del backend más el nombre de la línea
 * que alcanzó.
 */
export interface AppliedPromotionRow {
  /** El `uuid` de la fila del desglose; con él la sigue la tabla. */
  key: string;
  /** El nombre **del snapshot**: el que la promoción tenía el día de la venta. */
  name: string;
  /** El detalle corto **del snapshot**, ya escrito por el backend: `3x2`, `-10%`, `-$500`. */
  detail: string;
  /** El producto de la línea alcanzada, o `null` si no hay línea que nombrar. */
  line: string | null;
  /**
   * `true` si el descuento pegó sobre el **total de la venta** y no sobre una línea.
   *
   * Va aparte de `line === null` a propósito: los dos casos dejan la columna sin nombre pero
   * significan cosas distintas, y una fila cuya línea no se pudo resolver leída como «sobre el
   * total» le prometería a quien mira un prorrateo que no existe.
   */
  onOrderTotal: boolean;
  /** Las unidades que un NxM dejó en $0, o `null` cuando no hay ninguna que contar. */
  bonusQuantity: number | null;
  /** Lo que esta promoción descontó. */
  amount: number;
}

/** La sección «Promociones aplicadas» del detalle: sus filas y lo que suman. */
export interface AppliedPromotionsSection {
  rows: readonly AppliedPromotionRow[];
  /**
   * El descuento total de la venta: la suma de **todas** las filas.
   *
   * Se llama así y no `totalAmount` porque en este mismo diálogo `OrderCheckoutDto.totalAmount` es
   * el total de la orden: dos `totalAmount` con sentidos opuestos a treinta líneas de distancia son
   * los que terminan intercambiados.
   *
   * Tampoco es `orderCheckout.discountAmount`, que sólo acumula las de ámbito total. Acá está el
   * número que contesta «cuánto menos cobré», que es lo que se pregunta quien abre la venta.
   */
  totalDiscountAmount: number;
  /** `true` si alguna fila pegó sobre el total: es lo que decide si la nota del pie tiene qué decir. */
  hasOrderTotalRows: boolean;
}

/**
 * El desglose de promociones de una venta registrada, o `null` si no hay ninguna que mostrar.
 *
 * **No recalcula nada.** Los importes son los que el backend persistió al cobrar, y los textos salen
 * del snapshot de cada fila — no de la promoción viva, que para cuando alguien abre esta venta puede
 * llamarse distinto, haber cambiado de porcentaje o estar archivada. Esta función no recibe el
 * catálogo de promociones justamente para que no haya de dónde sacar el nombre de hoy.
 *
 * **Devuelve `null` y no una sección vacía**: una venta sin promociones no tiene que dibujar un
 * encabezado que después no dice nada.
 */
export function appliedPromotionsOf(order: OrderDto): AppliedPromotionsSection | null {
  const applied = order.promotions ?? [];
  if (applied.length === 0) {
    return null;
  }

  const lineNames = new Map<string, string>();
  for (const item of order.items ?? []) {
    if (item.uuid) {
      lineNames.set(item.uuid, item.product?.name ?? '');
    }
  }

  const rows = applied.map((row, index) => toRow(row, index, lineNames));

  return {
    rows,
    // Se redondea la suma, no cada término: los importes ya vienen redondeados del backend y sumar
    // dobles arrastra el resto binario —tres filas dan `443.79999…` sin esto—.
    totalDiscountAmount: round2(rows.reduce((total, row) => total + row.amount, 0)),
    hasOrderTotalRows: rows.some((row) => row.onOrderTotal),
  };
}

function toRow(
  row: OrderPromotionDto,
  index: number,
  lineNames: ReadonlyMap<string, string>,
): AppliedPromotionRow {
  const itemUuid = row.orderItemUuid ?? null;
  const line = itemUuid ? (lineNames.get(itemUuid) ?? null) : null;

  return {
    key: row.uuid ?? `${index}`,
    name: row.promotion?.name ?? '',
    detail: row.promotionDetail ?? '',
    line: line || null,
    onOrderTotal: itemUuid === null,
    // Cero no es «cero unidades bonificadas» sino «este tipo no bonifica»: el backend lo escribe en
    // las tres clases de promoción, así que la columna se deja vacía en vez de decir `0`.
    bonusQuantity: row.bonusQuantity ? row.bonusQuantity : null,
    amount: row.amount ?? 0,
  };
}
