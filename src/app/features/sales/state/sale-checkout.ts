/**
 * Los totales de la venta **con promociones**, en una sola función pura que corren los dos lugares
 * que los necesitan: el carrito, con los pagos ya registrados, y el diálogo de cobro, con los que
 * se están armando adentro.
 *
 * Que sea una sola es el punto. En el diálogo los pagos viven en una señal local y sólo salen al
 * confirmar, así que ahí hay un segundo juego de pagos que el carrito todavía no vio; si cada lado
 * calculara su total, el diálogo podría dar por saldado un cobro que el carrito rechaza —o cobrar
 * contra un total que el commit no va a confirmar—. La tolerancia con la que se compara el cobro ya
 * vivía en un solo lado por la misma razón (`paymentBalance`).
 *
 * No decide nada: el número que vale sigue siendo el del backend, que recalcula en el commit
 * (RN-14). Acá se anticipa, con el mismo motor replicado que los fixtures atan al Java (ADR-0002).
 */

import { LineAmounts, OrderTotals, sumTotals } from '../../../core/pricing/order-pricing';
import {
  PromotionApplication,
  PromotionCandidate,
  PromotionEvaluationResult,
  PromotionLineInput,
  evaluatePromotions,
  withPromotionDiscount,
} from '../../../core/pricing/promotion-engine';
import {
  SaleLinePromotion,
  SalePromotionDetail,
  SalePromotionDto,
  salePromotionDetailOf,
  toPromotionCandidate,
} from '../data-access/sale.model';

/**
 * En qué situación está una promoción respecto de esta venta. Son tres cosas distintas y se dibujan
 * distinto, porque prometen distinto:
 *
 * - `APPLIED`: ya descontó. Es plata que la venta le resta al cliente.
 * - `SUGGESTED`: descontaría si la venta se pagara con ciertos medios, y **todavía no hay ningún
 *   pago**. Se dibuja como algo no aplicado —borde punteado, verbo condicional—: confundirla con un
 *   descuento aplicado sería prometer de más.
 * - `DROPPED`: se cayó porque los pagos cargados no cumplen la condición. Se muestra tachada en $0 y
 *   **no se saca de la lista**: si desaparece, el vendedor ve subir el total sin explicación.
 */
export type SalePromotionStatus = 'APPLIED' | 'SUGGESTED' | 'DROPPED';

/** Una fila del desglose de descuentos del panel de totales. */
export interface SalePromotionRow {
  promotionKey: string;
  name: string;
  detail: SalePromotionDetail;
  /** Lo descontado en `APPLIED`, lo que se descontaría en `SUGGESTED`, `0` en una caída. */
  amount: number;
  status: SalePromotionStatus;
  /**
   * Los medios de pago que la promoción exige, por nombre. Vacío cuando no está condicionada.
   *
   * Es lo que convierte el aviso en algo accionable: «requiere pagar con Efectivo» le dice al
   * vendedor qué ofrecerle al cliente para recuperar el descuento.
   */
  requiredMethods: readonly string[];
}

/**
 * Todo lo que el motor necesita de la venta **menos los pagos**: líneas, promociones candidatas y
 * las condiciones contra las que se filtran.
 *
 * Los pagos van aparte a propósito — son lo único que cambia entre el carrito y el diálogo, y
 * dejarlos afuera es lo que permite que el diálogo re-evalúe con los suyos sin tocar el carrito.
 */
export interface SalePromotionContext {
  /** Sólo las líneas con precio, y sólo las **padre**: el motor no mira componentes (RN-18). */
  lines: readonly PromotionLineInput[];
  /** Las promociones de la empresa, **de la más antigua a la más nueva**: el orden es el desempate. */
  promotions: readonly SalePromotionDto[];
  /** `YYYY-MM-DD` de la fecha de operación: contra ella se evalúa la vigencia (RN-12). */
  operationDate: string | null;
  customerKey: string | null;
  branchKey: string | null;
}

/** Lo que sale de evaluar la venta: los totales, los importes y chips de cada línea, y el desglose. */
export interface SaleCheckout {
  totals: OrderTotals;
  /**
   * Los importes de cada línea **ya netos**, indexados por su posición en el carrito. Una línea que
   * ninguna promoción tocó está igual acá: el motor devuelve todas, descontadas o no.
   */
  lineAmounts: ReadonlyMap<number, LineAmounts>;
  /** Los chips de cada línea, indexados por su posición en el carrito. */
  linePromotions: ReadonlyMap<number, readonly SaleLinePromotion[]>;
  breakdown: readonly SalePromotionRow[];
}

/**
 * Evalúa la venta contra las promociones vigentes y devuelve lo que la pantalla muestra.
 *
 * @param paymentMethodKeys Un elemento por pago cargado, con el uuid de su medio. Los **montos no
 *   entran**: la condición por medio de pago depende de con qué se paga y no de cuánto (RN-17), y
 *   pasar los importes abriría la puerta a una circularidad que el motor no tiene.
 */
export function saleCheckoutOf(
  context: SalePromotionContext,
  paymentMethodKeys: readonly string[],
): SaleCheckout {
  // La antigüedad es la posición: la pantalla trae el catálogo ordenado por fecha de alta, que es
  // lo más cerca que el front puede estar del id de la fila con el que desempata el backend.
  const candidates = context.promotions.map((promotion, sequence) =>
    toPromotionCandidate(promotion, sequence),
  );
  const result = evaluatePromotions({
    lines: context.lines,
    promotions: candidates,
    context: {
      operationDate: context.operationDate,
      customerKey: context.customerKey,
      branchKey: context.branchKey,
      paymentMethodKeys,
    },
  });

  const amounts = amountsOf(context.lines, result);
  const lineTotals = sumTotals([...amounts.values()]);

  return {
    totals: {
      ...lineTotals,
      // El descuento de ámbito `ORDER_TOTAL` no pasa por las líneas —el motor lo resuelve sobre la
      // suma ya neta—, así que se agrega acá; y el total sale del motor, que es el único que aplicó
      // el piso en $0 (RN-07).
      discountAmount: lineTotals.discountAmount + result.orderDiscount,
      totalAmount: result.total,
    },
    lineAmounts: amounts,
    linePromotions: linePromotionsOf(context.promotions, result),
    breakdown: breakdownOf(context, candidates, result, paymentMethodKeys),
  };
}

/**
 * Los importes de cada línea después del motor, indexados por su índice en el carrito.
 *
 * `withPromotionDiscount` toma de la línea de lista **sólo el precio unitario** —es lo único que el
 * motor no toca (RN-19)— y reescribe el resto con el resultado. Los ceros que se le pasan son eso:
 * los importes que la función va a pisar, no una línea sin importes.
 */
function amountsOf(
  lines: readonly PromotionLineInput[],
  result: PromotionEvaluationResult,
): ReadonlyMap<number, LineAmounts> {
  const amounts = new Map<number, LineAmounts>();

  result.lines.forEach((line, position) => {
    amounts.set(
      lines[position].index,
      withPromotionDiscount(
        {
          unitPrice: lines[position].unitPrice,
          discountAmount: 0,
          netAmount: 0,
          taxAmount: 0,
          subtotal: 0,
        },
        line,
      ),
    );
  });

  return amounts;
}

/**
 * Los chips de cada línea, agrupados por su índice en el carrito.
 *
 * Una aplicación que no restó nada ni bonificó ninguna unidad no llega acá: el motor no la registra,
 * y una línea que sólo aportó unidades pagas a un NxM no tiene qué mostrar.
 */
function linePromotionsOf(
  promotions: readonly SalePromotionDto[],
  result: PromotionEvaluationResult,
): ReadonlyMap<number, readonly SaleLinePromotion[]> {
  const byKey = new Map(promotions.map((promotion) => [promotion.uuid, promotion]));
  const byLine = new Map<number, SaleLinePromotion[]>();

  for (const application of result.applications) {
    const lineIndex = application.lineIndex;
    const promotion = byKey.get(application.promotionKey);
    if (lineIndex === null || !promotion) {
      continue;
    }

    const chips = byLine.get(lineIndex) ?? [];
    chips.push({
      promotionKey: application.promotionKey,
      name: promotion.name,
      detail: salePromotionDetailOf(promotion),
      amount: application.amount,
      bonusQuantity: application.bonusQuantity,
    });
    byLine.set(lineIndex, chips);
  }

  return byLine;
}

/**
 * El desglose: lo que descontó cada promoción, lo que descontaría una condicionada que todavía no
 * entró, y lo que dejó de descontar la que se cayó.
 *
 * Una promoción que no alcanzó nada no aparece: el desglose contesta «¿por qué me sale esto?», y
 * llenarlo con reglas que no movieron un peso es la forma más rápida de que nadie lo lea.
 */
function breakdownOf(
  context: SalePromotionContext,
  candidates: readonly PromotionCandidate[],
  result: PromotionEvaluationResult,
  paymentMethodKeys: readonly string[],
): readonly SalePromotionRow[] {
  const applied = amountsByPromotion(result.applications);
  const rows: SalePromotionRow[] = [];

  context.promotions.forEach((promotion, position) => {
    const requiredMethods = (promotion.paymentMethods ?? []).map((method) => method.name);
    const amount = applied.get(promotion.uuid);

    if (amount != null) {
      rows.push(row(promotion, amount, 'APPLIED', requiredMethods));
      return;
    }
    if (requiredMethods.length === 0) {
      return;
    }

    // Condicionada, sin aplicar y **con la condición de pago cumplida**: entonces no se cayó por los
    // medios, perdió por otra cosa —el desempate de una no acumulable, las unidades que otro NxM se
    // llevó primero—. Decirle al vendedor «requiere pagar con Efectivo» mientras está cobrando en
    // efectivo es darle como consejo lo que ya está haciendo, que es peor que no decir nada.
    if (paymentsSatisfy(candidates[position], paymentMethodKeys)) {
      return;
    }

    // De las que sí se cayeron por los medios, sólo interesa la que **descontaría algo** de haberse
    // pagado como pide: una que tampoco alcanza ninguna línea del carrito no se cayó de ningún lado,
    // y anunciar que se perdió un descuento que nunca existió es ruido en la única lista que el
    // vendedor lee para contestar «¿por qué me sale esto?».
    const offered = wouldDiscount(context, candidates, position);
    if (offered === 0) {
      return;
    }

    // Lo que separa la sugerencia de la caída es si ya hay pagos cargados: sin ninguno todavía no se
    // prometió nada y esto es una oferta; con alguno, el vendedor acaba de ver subir el total y lo
    // que necesita es el motivo. La caída va en $0 y tachada, no descontando de mentira.
    rows.push(
      paymentMethodKeys.length > 0
        ? row(promotion, 0, 'DROPPED', requiredMethods)
        : row(promotion, offered, 'SUGGESTED', requiredMethods),
    );
  });

  return rows;
}

/**
 * Si los pagos cargados cumplen la condición de la promoción: todo-o-nada (RN-17). Hace falta al
 * menos un pago, y todos con medios del conjunto — uno solo con un medio ajeno la desactiva entera.
 *
 * Es la misma regla que aplica el motor puertas adentro para decidir qué promociones entran. Acá se
 * vuelve a preguntar porque el desglose necesita algo que el resultado no dice: **por qué** una
 * promoción no aplicó. El motor devuelve lo que descontó, no lo que descartó.
 */
function paymentsSatisfy(
  candidate: PromotionCandidate,
  paymentMethodKeys: readonly string[],
): boolean {
  if (paymentMethodKeys.length === 0) {
    return false;
  }

  return paymentMethodKeys.every((key) => candidate.paymentMethodKeys?.includes(key));
}

function row(
  promotion: SalePromotionDto,
  amount: number,
  status: SalePromotionStatus,
  requiredMethods: readonly string[],
): SalePromotionRow {
  return {
    promotionKey: promotion.uuid,
    name: promotion.name,
    detail: salePromotionDetailOf(promotion),
    amount,
    status,
    requiredMethods,
  };
}

/** Lo que cada promoción descontó en total, sumando todas las líneas que alcanzó. */
function amountsByPromotion(
  applications: readonly PromotionApplication[],
): ReadonlyMap<string, number> {
  const amounts = new Map<string, number>();

  for (const application of applications) {
    amounts.set(
      application.promotionKey,
      (amounts.get(application.promotionKey) ?? 0) + application.amount,
    );
  }

  return amounts;
}

/**
 * Cuánto descontaría la promoción condicionada si la venta se pagara con los medios que exige.
 *
 * Es una evaluación entera y no una cuenta aparte: la sugerencia tiene que salir del mismo motor que
 * el descuento real, o el número que se le ofrece al cliente no va a ser el que se cobre. Se evalúa
 * con **sólo esta** condicionada en juego —las demás condicionadas se sacan— porque lo que se está
 * ofreciendo es esta, y mezclarlas anticiparía un descuento que exige pagar de dos formas a la vez.
 */
function wouldDiscount(
  context: SalePromotionContext,
  candidates: readonly PromotionCandidate[],
  position: number,
): number {
  const offered = candidates[position];
  const promotions = candidates.filter(
    (candidate, index) => index === position || !candidate.paymentMethodKeys?.length,
  );

  const hypothesis = evaluatePromotions({
    lines: context.lines,
    promotions,
    context: {
      operationDate: context.operationDate,
      customerKey: context.customerKey,
      branchKey: context.branchKey,
      paymentMethodKeys: offered.paymentMethodKeys ?? [],
    },
  });

  return hypothesis.applications
    .filter((application) => application.promotionKey === offered.key)
    .reduce((total, application) => total + application.amount, 0);
}
