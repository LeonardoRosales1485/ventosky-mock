/**
 * El motor de promociones replicado en TypeScript, al lado del pricing que ya se replica por la
 * misma razón: el vendedor tiene que ver el descuento **mientras arma el carrito**, y el carrito se
 * re-evalúa ante cada cambio de línea, cantidad, cliente, fecha, comprobante y cada alta o baja de
 * un pago. Una llamada de red en cada uno de esos eventos es un POS que se siente roto.
 *
 * El número que vale sigue siendo el del backend: el commit no manda importes, el backend recalcula
 * y es la autoridad. Por eso el orden de las operaciones y el redondeo copian a
 * `PromotionEngineService` al pie de la letra —si se separan un centavo, los pagos no cierran
 * contra el total y el commit tira 400 con el cliente parado en el mostrador—, y por eso las dos
 * implementaciones están atadas a los mismos fixtures (ADR-0002).
 *
 * El pipeline es determinístico y siempre corre en este orden: precio base, sin cambios → NxM →
 * descuentos por producto (porcentuales en cascada, después montos fijos) → descuentos sobre el
 * total (mismo orden) → piso en $0. El resultado es único e independiente del orden de carga.
 *
 * **Sólo mira líneas padre** (ADR-0003): quien lo llama no le pasa las hijas de un kit, y el factor
 * de cada línea es lo que después las escala.
 */

import { divide, round2, scaled } from './decimals';
import { LineAmounts } from './order-pricing';

/** `PromotionType`: los tres tipos de promoción. Viaja como el nombre plano del enum. */
export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'NXM';

/** `PromotionScope`: dónde se resta la plata, que no es lo mismo que qué productos alcanza. */
export type PromotionScope = 'PRODUCTS' | 'ORDER_TOTAL';

/**
 * Una promoción candidata tal como la ve el motor. Es la forma exacta del fixture compartido, y por
 * eso todo lo opcional lo es de verdad: **toda colección vacía o ausente significa «todos»** —sin
 * clientes es para cualquiera, sin sucursales aplica en todas, sin medios de pago no mira los
 * pagos—.
 */
export interface PromotionCandidate {
  /** Identificador opaco: el id de la fila en el backend, lo que tenga el catálogo en el front. */
  key: string;
  /**
   * Orden de antigüedad: menor es más antigua. Desempata los NxM de igual fracción bonificada y las
   * no acumulables de igual descuento. En el backend es el id de la fila.
   */
  sequence: number;
  name?: string;
  type: PromotionType;
  scope: PromotionScope;
  percent?: number | null;
  amount?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  /** Ausente es acumulable: es el default de la columna. */
  combinable?: boolean;
  discontinued?: boolean;
  /** Fechas ISO (`YYYY-MM-DD`), día completo: son `LocalDate` del otro lado, no instantes. */
  validFrom?: string | null;
  validUntil?: string | null;
  productKeys?: readonly string[];
  categoryKeys?: readonly string[];
  customerKeys?: readonly string[];
  branchKeys?: readonly string[];
  paymentMethodKeys?: readonly string[];
}

/**
 * Una línea padre de la venta tal como la ve el motor: producto, categorías que la alcanzan,
 * cantidad e importes ya resueltos por la lista de precios.
 */
export interface PromotionLineInput {
  /**
   * Posición de la línea en el carrito, desde cero. Es la clave de desempate del NxM entre unidades
   * del mismo precio. Es el **único** criterio que las dos implementaciones no comparten
   * literalmente: el backend usa el id de `order_items`, que acá todavía no existe.
   */
  index: number;
  productKey: string;
  /**
   * La categoría del producto y todas sus ancestras hasta la raíz. Con la cadena ya resuelta, «la
   * categoría incluye todo su subárbol» se reduce a una intersección de conjuntos.
   */
  categoryKeys?: readonly string[];
  quantity: number;
  /** Precio unitario de lista, ya redondeado. Nunca se toca. */
  unitPrice: number;
  /** Neto de la línea antes de promociones: `unitPrice × quantity`. */
  net: number;
  /** Impuesto antes de promociones. Cero si el comprobante no discrimina. */
  taxAmount?: number | null;
  /**
   * Subtotal persistido de la línea. Opcional: sin él vale `net + taxAmount`. Existe porque la
   * regla de precio puede redondear el subtotal a múltiplos de $10 o $100, y una línea que el motor
   * no toca tiene que aportar a la base de los descuentos sobre el total **exactamente** lo que
   * después suma el checkout.
   */
  subtotal?: number | null;
}

/** Las condiciones de la venta contra las que se filtran las promociones. */
export interface PromotionEvaluationContext {
  /** Fecha de la operación (`YYYY-MM-DD`, día completo): contra ella se evalúa la vigencia. */
  operationDate?: string | null;
  /** El rol cliente de la venta; ausente en la venta sin tercero. */
  customerKey?: string | null;
  branchKey?: string | null;
  /** Un elemento por pago cargado. Vacío en un presupuesto. */
  paymentMethodKeys?: readonly string[];
}

/** Todo lo que entra al motor. Es la forma exacta de los fixtures compartidos. */
export interface PromotionEvaluationInput {
  lines: readonly PromotionLineInput[];
  promotions: readonly PromotionCandidate[];
  context: PromotionEvaluationContext;
}

/**
 * Una promoción aplicada: sobre qué línea, cuánto descontó y —en un NxM— cuántas unidades bonificó.
 * Es lo que el desglose muestra en pantalla.
 */
export interface PromotionApplication {
  promotionKey: string;
  /** Índice de la línea, o `null` si el descuento es sobre el total de la venta. */
  lineIndex: number | null;
  bonusQuantity: number;
  amount: number;
}

/** Lo que queda de una línea después del motor. */
export interface PromotionLineResult {
  index: number;
  /** `neto final / neto original`, sin redondear. Es el que escala las hijas de un kit. */
  factor: number;
  /** Suma de lo que las promociones le restaron al neto. */
  discountAmount: number;
  /** Neto descontado. */
  net: number;
  /** Impuesto sobre el neto descontado. */
  taxAmount: number;
  /** El subtotal de la línea, ya neto de descuento. */
  subtotal: number;
}

/** Todo lo que sale del motor: una línea por línea de entrada, el desglose y los totales. */
export interface PromotionEvaluationResult {
  lines: readonly PromotionLineResult[];
  applications: readonly PromotionApplication[];
  /** Σ subtotales de línea, ya netos. Es la base de los descuentos sobre el total. */
  linesSubtotal: number;
  /** Σ descuentos de ámbito `ORDER_TOTAL`. */
  orderDiscount: number;
  /** `linesSubtotal − orderDiscount`, nunca negativo. Es el total que se cobra. */
  total: number;
}

/**
 * Evalúa el carrito contra las promociones candidatas. Es una **función pura**: sin servicios
 * inyectados, sin HTTP y sin señales adentro. Lo llaman el carrito y el diálogo de cobro.
 */
export function evaluatePromotions(input: PromotionEvaluationInput): PromotionEvaluationResult {
  let applicable = applicableOf(input);
  let result = run(input.lines, applicable);

  // Caso borde: si una promoción condicionada por medio de pago deja la venta en $0, la venta queda
  // sin pagos y la condición deja de cumplirse. El punto estable es sin ESA promoción: se saca la
  // última condicionada que aplicó —la que cerró el total— y se vuelve a evaluar, hasta que quede
  // plata que cobrar o no quede ninguna condicionada aplicada.
  while (result.total === 0) {
    const culprit = lastAppliedConditionedByPayment(result, applicable);
    if (!culprit) {
      break;
    }
    applicable = applicable.filter((candidate) => candidate !== culprit);
    result = run(input.lines, applicable);
  }

  return result;
}

/**
 * Pasa los importes que devolvió el motor a la forma que consume el checkout. Es el puente entre el
 * motor y {@link LineAmounts}: el subtotal de la línea viaja **ya neto**, y el descuento viaja
 * aparte para que `sumTotals` lo pueda acumular.
 */
export function withPromotionDiscount(
  amounts: LineAmounts,
  line: PromotionLineResult,
): LineAmounts {
  return {
    unitPrice: amounts.unitPrice,
    discountAmount: line.discountAmount,
    netAmount: line.net,
    taxAmount: line.taxAmount,
    subtotal: line.subtotal,
  };
}

/** Estado de trabajo de una línea mientras corre el pipeline. */
interface EngineLine {
  readonly input: PromotionLineInput;
  /** Unidades enteras que ningún NxM tomó todavía. Cero en una cantidad fraccionaria. */
  freeUnits: number;
  /** El neto después de cada paso; arranca en el de la lista. */
  net: number;
  /** Una no acumulable ya aplicó sobre la línea: nada más de producto entra. */
  closed: boolean;
  /** Unidades que un NxM dejó en $0. Los montos fijos por unidad no las cuentan. */
  bonusedUnits: number;
  readonly applications: PromotionApplication[];
}

/** Una unidad elegible libre dentro del pool de un NxM: de qué línea sale y cuánto vale. */
interface NxmUnit {
  readonly line: EngineLine;
  readonly unitPrice: number;
}

/** Filtra por vigencia, discontinuación, audiencia, sucursal y medios de pago. */
function applicableOf(input: PromotionEvaluationInput): PromotionCandidate[] {
  const context = input.context;

  return input.promotions.filter((candidate) => {
    if (candidate.discontinued || !isInForce(candidate, context.operationDate)) {
      return false;
    }
    if (
      candidate.customerKeys?.length &&
      (!context.customerKey || !candidate.customerKeys.includes(context.customerKey))
    ) {
      return false;
    }
    if (
      candidate.branchKeys?.length &&
      (!context.branchKey || !candidate.branchKeys.includes(context.branchKey))
    ) {
      return false;
    }

    return !isConditionedByPayment(candidate) || paymentsSatisfy(candidate, context);
  });
}

/**
 * Vigencia contra la fecha de operación. Las fechas se comparan **como texto**: son `LocalDate` del
 * otro lado —días completos, no instantes— y en ISO el orden lexicográfico es el cronológico.
 * Pasarlas por `Date` sólo agregaría una zona horaria que del lado Java no existe.
 */
function isInForce(candidate: PromotionCandidate, date: string | null | undefined): boolean {
  const day = dayOf(date);
  const from = dayOf(candidate.validFrom);
  const until = dayOf(candidate.validUntil);
  if (!day || !from || day < from) {
    return false;
  }

  return !until || day <= until;
}

/**
 * El día de una fecha ISO, descartando la hora si viene.
 *
 * Del lado Java el tipo es `LocalDate` y la hora no puede llegar; acá el tipo sólo lo pide en un
 * comentario, y un `2026-09-17T10:00` comparado como texto pasa el `>= validFrom` pero falla el
 * `<= validUntil` **el último día de vigencia**: la promoción se apagaría sola a la medianoche del
 * día que todavía está vigente. Recortar es más barato que descubrirlo en el mostrador.
 */
function dayOf(date: string | null | undefined): string | null {
  return date ? date.slice(0, 10) : null;
}

function isConditionedByPayment(candidate: PromotionCandidate): boolean {
  return !!candidate.paymentMethodKeys?.length;
}

/** Todo-o-nada: al menos un pago, y todos con medios del conjunto. */
function paymentsSatisfy(
  candidate: PromotionCandidate,
  context: PromotionEvaluationContext,
): boolean {
  const payments = context.paymentMethodKeys;
  if (!payments?.length) {
    return false;
  }

  return payments.every((key) => candidate.paymentMethodKeys?.includes(key));
}

/** La línea cae en el conjunto elegible: por producto puntual o por alguna categoría de su cadena. */
function reaches(candidate: PromotionCandidate, line: PromotionLineInput): boolean {
  if (candidate.productKeys?.includes(line.productKey)) {
    return true;
  }

  return !!line.categoryKeys?.some((key) => candidate.categoryKeys?.includes(key));
}

/**
 * Fracción bonificada de un NxM: `(N − M) / N`. Ordena el reparto entre NxM.
 *
 * El guard mira **ausencia**, no falsedad: un `payQuantity` en cero es un dato que el validador del
 * backend no deja entrar, pero si entrara el Java devolvería 1 y no 0. Es la función de desempate
 * del reparto, y acá un `!pay` en lugar de un `pay == null` cambia el orden en que los NxM toman
 * las unidades.
 */
function bonusFraction(candidate: PromotionCandidate): number {
  const buy = candidate.buyQuantity;
  const pay = candidate.payQuantity;
  if (buy == null || pay == null || buy <= 0) {
    return 0;
  }

  return (buy - pay) / buy;
}

function isCombinable(candidate: PromotionCandidate): boolean {
  return candidate.combinable !== false;
}

/** La última aplicación del pipeline que sale de una condicionada por medio de pago. */
function lastAppliedConditionedByPayment(
  result: PromotionEvaluationResult,
  applicable: readonly PromotionCandidate[],
): PromotionCandidate | null {
  let last: PromotionCandidate | null = null;

  for (const application of result.applications) {
    for (const candidate of applicable) {
      if (candidate.key === application.promotionKey && isConditionedByPayment(candidate)) {
        last = candidate;
      }
    }
  }

  return last;
}

function run(
  inputs: readonly PromotionLineInput[],
  promotions: readonly PromotionCandidate[],
): PromotionEvaluationResult {
  const lines = inputs.map(toEngineLine);

  allocateNxm(lines, nxmOf(promotions));
  const lineDiscounts = discountsOf(promotions, 'PRODUCTS');
  for (const line of lines) {
    applyLineDiscounts(line, lineDiscounts);
  }

  const results: PromotionLineResult[] = [];
  const applications: PromotionApplication[] = [];
  let linesSubtotal = 0;
  for (const line of lines) {
    const result = toLineResult(line);
    results.push(result);
    applications.push(...line.applications);
    linesSubtotal = scaled(linesSubtotal + result.subtotal);
  }

  const order = applyOrderDiscounts(linesSubtotal, discountsOf(promotions, 'ORDER_TOTAL'));
  applications.push(...order.applications);

  return {
    lines: results,
    applications,
    linesSubtotal,
    orderDiscount: order.discount,
    total: Math.max(0, scaled(linesSubtotal - order.discount)),
  };
}

function toEngineLine(input: PromotionLineInput): EngineLine {
  return {
    input,
    freeUnits: wholeUnits(input.quantity),
    net: input.net,
    closed: false,
    bonusedUnits: 0,
    applications: [],
  };
}

/**
 * Un NxM cuenta unidades enteras: una línea de 2,5 kg no aporta «dos unidades y media», no aporta
 * ninguna.
 */
function wholeUnits(quantity: number): number {
  return quantity > 0 && Number.isInteger(quantity) ? quantity : 0;
}

/** Los NxM, que son los únicos que reparten unidades y por eso corren en su propio paso. */
function nxmOf(promotions: readonly PromotionCandidate[]): PromotionCandidate[] {
  return promotions.filter(
    (candidate) => candidate.scope === 'PRODUCTS' && candidate.type === 'NXM',
  );
}

/** Los descuentos —porcentaje o monto fijo— de un ámbito: los que entran a una cascada. */
function discountsOf(
  promotions: readonly PromotionCandidate[],
  scope: PromotionScope,
): PromotionCandidate[] {
  return promotions.filter((candidate) => candidate.scope === scope && candidate.type !== 'NXM');
}

/**
 * Paso 2: el reparto de unidades entre los NxM.
 *
 * Está escrito como algoritmo y no como intención porque vive dos veces —acá y en Java— y tiene que
 * dar el mismo centavo:
 *
 * 1. Los NxM se ordenan por fracción bonificada `(N−M)/N` descendente; a igualdad, el más antiguo.
 *    Cada uno toma en su turno las unidades que quedan libres.
 * 2. Las unidades elegibles libres se ordenan por precio unitario descendente; a igualdad, por
 *    índice de línea ascendente.
 * 3. Se cortan en bloques consecutivos de N. Las que no completan bloque vuelven al pool.
 * 4. En cada bloque las últimas (N−M) son las bonificadas: las más baratas *del bloque*.
 *
 * No es una búsqueda del óptimo global: es una heurística determinística.
 */
function allocateNxm(lines: readonly EngineLine[], nxmPromotions: PromotionCandidate[]): void {
  const ordered = [...nxmPromotions].sort(
    (a, b) => bonusFraction(b) - bonusFraction(a) || a.sequence - b.sequence,
  );

  for (const promotion of ordered) {
    allocateOne(lines, promotion);
  }
}

/**
 * Toda línea que puso una unidad en un bloque queda **alcanzada** por el NxM, haya recibido la
 * bonificada o sólo las pagas: si la promoción no es acumulable, ninguna de esas líneas recibe
 * después porcentajes ni montos fijos de producto, tampoco sobre las unidades que quedaron fuera de
 * bloque. Las líneas que sólo aportaron sobrantes no se tocan.
 */
function allocateOne(lines: readonly EngineLine[], promotion: PromotionCandidate): void {
  const buy = promotion.buyQuantity ?? 0;
  const bonused = buy - (promotion.payQuantity ?? 0);
  // Sólo se frena lo que del otro lado sería una división por cero. Un N = M no se saltea: el Java
  // igual consume las unidades del bloque y cierra las líneas si la promoción no es acumulable, y
  // saltearlo acá sería una divergencia escrita a mano en el reparto.
  if (buy <= 0) {
    return;
  }

  const pool = freeUnitsPool(lines, promotion);
  const blocks = Math.floor(pool.length / buy);
  if (blocks === 0) {
    return;
  }

  const byLine = new Map<EngineLine, { bonusQuantity: number; amount: number }>();
  for (let block = 0; block < blocks; block++) {
    for (let position = 0; position < buy; position++) {
      const unit = pool[block * buy + position];
      unit.line.freeUnits -= 1;
      let totals = byLine.get(unit.line);
      if (!totals) {
        totals = { bonusQuantity: 0, amount: 0 };
        byLine.set(unit.line, totals);
      }
      if (position >= buy - bonused) {
        totals.bonusQuantity += 1;
        totals.amount = scaled(totals.amount + unit.unitPrice);
      }
    }
  }

  for (const [line, totals] of byLine) {
    discountLine(line, promotion.key, totals.bonusQuantity, totals.amount);
    if (!isCombinable(promotion)) {
      line.closed = true;
    }
  }
}

/** Las unidades libres de las líneas alcanzadas, en el orden que fija el paso 2. */
function freeUnitsPool(
  lines: readonly EngineLine[],
  promotion: PromotionCandidate,
): readonly NxmUnit[] {
  const pool: NxmUnit[] = [];

  for (const line of lines) {
    if (!reaches(promotion, line.input)) {
      continue;
    }
    for (let i = 0; i < line.freeUnits; i++) {
      pool.push({ line, unitPrice: line.input.unitPrice });
    }
  }

  return pool.sort((a, b) => b.unitPrice - a.unitPrice || a.line.input.index - b.line.input.index);
}

/** Resta el descuento de un paso y lo registra. El neto nunca baja de cero. */
function discountLine(
  line: EngineLine,
  promotionKey: string,
  bonusQuantity: number,
  amount: number,
): void {
  const effective = Math.max(0, Math.min(amount, line.net));
  if (effective === 0 && bonusQuantity === 0) {
    return;
  }

  line.net = scaled(line.net - effective);
  line.bonusedUnits += Math.trunc(bonusQuantity);
  line.applications.push({
    promotionKey,
    lineIndex: line.input.index,
    bonusQuantity,
    amount: effective,
  });
}

/** Las unidades que pagan: sobre ellas se cuenta un monto fijo por unidad. */
function paidUnits(line: EngineLine): number {
  return Math.max(0, scaled(line.input.quantity - line.bonusedUnits));
}

/**
 * Paso 3: los descuentos de producto sobre la línea, salvo que un NxM no acumulable ya la cerró.
 * Un monto fijo «por unidad» cuenta las unidades que pagan: las que un NxM acumulable dejó en $0 ya
 * no tienen de dónde descontar.
 */
function applyLineDiscounts(line: EngineLine, lineDiscounts: readonly PromotionCandidate[]): void {
  if (line.closed || line.net <= 0) {
    return;
  }

  const reaching = lineDiscounts.filter((candidate) => reaches(candidate, line.input));
  const units = paidUnits(line);
  for (const candidate of selectCascade(reaching, line.net, units)) {
    discountLine(line, candidate.key, 0, discountOf(candidate, line.net, units));
  }
}

/** Paso 4: los descuentos sobre el total, sobre la suma de subtotales ya netos. */
function applyOrderDiscounts(
  base: number,
  orderDiscounts: readonly PromotionCandidate[],
): { discount: number; applications: PromotionApplication[] } {
  const applications: PromotionApplication[] = [];
  let remaining = base;
  let total = 0;

  for (const candidate of selectCascade(orderDiscounts, base, 1)) {
    const discount = discountOf(candidate, remaining, 1);
    if (discount === 0) {
      continue;
    }
    remaining = scaled(remaining - discount);
    total = scaled(total + discount);
    applications.push({
      promotionKey: candidate.key,
      lineIndex: null,
      bonusQuantity: 0,
      amount: discount,
    });
  }

  return { discount: total, applications };
}

/**
 * Las promociones que efectivamente entran a la cascada, en el orden en que se aplican: primero los
 * porcentuales, cada uno sobre el neto que dejó el anterior; después los montos fijos. Si entre las
 * candidatas hay alguna no acumulable, aplica sólo una: la de mayor descuento, y a igualdad la más
 * antigua.
 *
 * @param base el importe sobre el que se calcula el descuento de comparación.
 * @param unitCount multiplicador de los montos fijos: la cantidad de la línea, o 1 en el total.
 */
function selectCascade(
  candidates: readonly PromotionCandidate[],
  base: number,
  unitCount: number,
): readonly PromotionCandidate[] {
  const exclusive = candidates.filter((candidate) => !isCombinable(candidate));
  if (exclusive.length > 0) {
    return [
      [...exclusive].sort(
        (a, b) =>
          discountOf(b, base, unitCount) - discountOf(a, base, unitCount) ||
          a.sequence - b.sequence,
      )[0],
    ];
  }

  return [...candidates].sort((a, b) => cascadeRank(a) - cascadeRank(b) || a.sequence - b.sequence);
}

function cascadeRank(candidate: PromotionCandidate): number {
  return candidate.type === 'PERCENTAGE' ? 0 : 1;
}

/** Cuánto descuenta la promoción sobre `base`, redondeado a dos decimales y sin pasar de la base. */
function discountOf(candidate: PromotionCandidate, base: number, unitCount: number): number {
  const raw =
    candidate.type === 'PERCENTAGE'
      ? divide(base * (candidate.percent ?? 0), 100)
      : (candidate.amount ?? 0) * unitCount;

  return Math.max(0, Math.min(round2(raw), base));
}

/**
 * Los importes finales de la línea. El impuesto escala con el neto —`impuesto × neto final / neto
 * original`, redondeado a dos decimales—, que es lo mismo que calcularlo sobre el neto descontado y
 * lo que mantiene exacta la alícuota efectiva de un kit con alícuotas mezcladas.
 *
 * Una línea que el motor no tocó conserva **su** subtotal de lista, que la regla de precio pudo
 * haber redondeado a múltiplos: es lo que después suma el checkout, y la base de los descuentos
 * sobre el total tiene que ser exactamente ese número.
 */
function toLineResult(line: EngineLine): PromotionLineResult {
  const input = line.input;
  const original = input.net;
  const net = line.net;
  const taxBefore = input.taxAmount ?? 0;
  const untouched = net === original;
  const taxAmount = untouched ? taxBefore : round2(divide(taxBefore * net, original));

  return {
    index: input.index,
    factor: original === 0 ? 1 : divide(net, original),
    discountAmount: scaled(original - net),
    net,
    taxAmount,
    subtotal: untouched && input.subtotal != null ? input.subtotal : scaled(net + taxAmount),
  };
}
