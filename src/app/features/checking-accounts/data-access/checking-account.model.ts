/**
 * Cuentas corrientes — tipos del dominio y las derivaciones que el análisis funcional deja
 * deliberadamente **fuera** de una columna guardada.
 *
 * Dos reglas del documento gobiernan todo este archivo:
 *
 * 1. **Una sola convención de signos** (§3.1): la partida deudora aumenta el saldo y la acreedora
 *    lo reduce, en las dos mitades. `balance > 0` significa «el cliente nos debe» en una cuenta
 *    `CUSTOMER` y «le debemos al proveedor» en una `SUPPLIER`; lo único que cambia es el cartel.
 *    Un `balance < 0` es siempre saldo a favor del titular.
 * 2. **El estado es derivado, no transicionado** (§7.1 y §9.1): ni el estado de una deuda ni el
 *    nivel de morosidad se guardan. Se calculan contra la fecha de hoy cada vez que se los mira,
 *    que es lo que hace que una deuda venza sola, sin proceso nocturno que pueda desincronizarse.
 *    Por eso {@link debtState} y {@link delinquencyLevel} viven acá, puros y testeables, y no en
 *    el servicio ni en el template.
 */

import { DelinquencyLevel } from '../../../core/checking-accounts/account-availability.model';
import { daysBetween, todayIso } from '../../../core/date/iso-date';

export type PartyRole = 'CUSTOMER' | 'SUPPLIER';

export type DocType = 'CUIT' | 'CUIL' | 'DNI';

/**
 * Los cuatro peldaños (§9.1). Se declaran en `core/` —los comparten el mostrador y la nueva
 * compra, que no pueden importar de este feature— y se re-exportan acá para que el módulo siga
 * teniendo un único lugar de donde importar sus tipos.
 */
export type { DelinquencyLevel };

/** §7 — el orden importa: una anulada no se informa vencida, y una pagada tampoco. */
export type DebtState = 'ANULADA' | 'PAGADA' | 'VENCIDA' | 'PARCIAL' | 'PENDIENTE';

export type DebtOrigin = 'ORDER' | 'ADJUSTMENT' | 'OPENING_BALANCE' | 'REFUND';

export type CreditOrigin = 'RECEIPT' | 'CREDIT_NOTE' | 'ADJUSTMENT';

/** Estado de imputación de un crédito; derivado de `unallocatedAmount`, igual que el de la deuda. */
export type CreditState = 'ANULADO' | 'IMPUTADO' | 'PARCIAL' | 'SIN_IMPUTAR';

export type AllocationMode = 'AUTOMATIC' | 'MANUAL';

/** §5.2 — la herencia tiene tres estados, así que el valor resuelto dice de qué peldaño salió. */
export type PolicySource = 'DEFAULT' | 'COMPANY' | 'ACCOUNT';

/** §10 — lo que el POS pinta sin volver a razonar la regla. */
export type AvailabilityDecision = 'ALLOWED' | 'WARN' | 'BLOCKED';

export interface PartyRef {
  uuid: string;
  name: string;
  docType: DocType;
  docNumber: string;
  /** Los dos roles del tercero, para saber si se le puede ofrecer compensar (§8.5). */
  roles: readonly PartyRole[];
  email: string | null;
}

/** Un valor de política ya resuelto, con el peldaño del que salió. `null` = ilimitado. */
export interface ResolvedPolicyValue<T> {
  value: T;
  source: PolicySource;
}

export interface ResolvedPolicy {
  dueDays: ResolvedPolicyValue<number>;
  /** `null` = sin tope. */
  debtLimit: ResolvedPolicyValue<number | null>;
  /** `null` = sin tope de cantidad de deudas abiertas. */
  openDebtLimit: ResolvedPolicyValue<number | null>;
  allocationMode: ResolvedPolicyValue<AllocationMode>;
  notifyOnDue: ResolvedPolicyValue<boolean>;
  dueSoonDays: ResolvedPolicyValue<number>;
}

/** §9.2 — override manual del nivel, siempre con fecha de fin. */
export interface DelinquencyException {
  level: DelinquencyLevel;
  /** Fecha (inclusive) hasta la que rige. Vencida, la cuenta vuelve sola a su nivel calculado. */
  dateUntil: string;
  reason: string;
  authorizedBy: string;
}

export interface CheckingAccountDto {
  uuid: string;
  party: PartyRef;
  role: PartyRole;
  /** Kill switch por titular: apagada, el medio «cuenta corriente» no se ofrece. */
  enabled: boolean;
  /** Σ deudas pendientes − Σ créditos sin imputar. Positivo = el titular debe. */
  balance: number;
  /** Σ pendiente de las deudas vencidas. */
  overdueAmount: number;
  openDebtCount: number;
  /** Días vencidos de la deuda vencida más antigua; 0 si no hay ninguna. */
  oldestOverdueDays: number;
  delinquencyException: DelinquencyException | null;
  policy: ResolvedPolicy;
  lastMovementDate: string | null;
}

export interface CheckingAccountDebtDto {
  uuid: string;
  accountUuid: string;
  origin: DebtOrigin;
  publicId: string;
  /** Importe original, inmutable. */
  amount: number;
  pendingAmount: number;
  dateIssued: string;
  /** El vigente: sólo lo mueve una prórroga. */
  dateDue: string;
  /** El primero; nunca cambia. Distinto de `dateDue` = la deuda fue prorrogada. */
  dateDueOriginal: string;
  dateVoided: string | null;
  voidReason: string | null;
  branchName: string;
  /** Detalle del comprobante que la originó, para el extracto. */
  description: string;
}

export interface CreditPaymentDto {
  paymentMethodName: string;
  amount: number;
  /** Un medio que no toca caja (transferencia) no genera movimiento (§11). */
  affectsCashRegister: boolean;
}

export interface CheckingAccountCreditDto {
  uuid: string;
  accountUuid: string;
  origin: CreditOrigin;
  publicId: string;
  amount: number;
  unallocatedAmount: number;
  dateIssued: string;
  dateVoided: string | null;
  voidReason: string | null;
  branchName: string;
  description: string;
  payments: readonly CreditPaymentDto[];
}

export interface CheckingAccountAllocationDto {
  uuid: string;
  accountUuid: string;
  debtUuid: string;
  debtPublicId: string;
  creditUuid: string;
  creditPublicId: string;
  amount: number;
  mode: AllocationMode;
  dateCreated: string;
  dateReversed: string | null;
  reverseReason: string | null;
  userName: string;
}

/** Una fila del extracto (§14): cronológico, con saldo acumulado. */
export interface StatementEntryDto {
  uuid: string;
  date: string;
  kind: 'DEBT' | 'CREDIT';
  origin: DebtOrigin | CreditOrigin;
  publicId: string;
  description: string;
  /** Lo que aumenta el saldo. Excluyente con `creditAmount`. */
  debitAmount: number | null;
  creditAmount: number | null;
  runningBalance: number;
  voided: boolean;
}

/** §15 `/availability` — la decisión ya resuelta, para que el POS sólo la pinte. */
export interface AccountAvailabilityDto {
  accountUuid: string;
  balance: number;
  debtLimit: number | null;
  /** `null` cuando el límite es ilimitado. */
  availableAmount: number | null;
  openDebtCount: number;
  openDebtLimit: number | null;
  delinquency: DelinquencyLevel;
  decision: AvailabilityDecision;
  /** Claves de traducción de los motivos, en el orden de validación de §10. */
  reasonKeys: readonly string[];
  /** El bloqueo se puede forzar con `checking_account.override_limit` (§10.2). */
  overridable: boolean;
}

/** Las tres tarjetas del encabezado del listado. */
export interface CheckingAccountsSummaryDto {
  receivableTotal: number;
  payableTotal: number;
  dueSoonTotal: number;
  dueSoonDays: number;
  severelyDelinquentCount: number;
  severelyDelinquentDelta: number;
}

export interface CollectionListItemDto {
  uuid: string;
  accountUuid: string;
  partyName: string;
  role: PartyRole;
  publicId: string;
  origin: CreditOrigin;
  dateIssued: string;
  amount: number;
  unallocatedAmount: number;
  dateVoided: string | null;
  paymentSummary: string;
}

/** Fila del listado de cuentas: la cuenta más lo que la pantalla ordena y filtra. */
export interface CheckingAccountListItemDto extends CheckingAccountDto {
  delinquency: DelinquencyLevel;
  availableAmount: number | null;
}

/* ──────────────────────────  Lo que devuelve el backend  ────────────────────────── */

/** El titular tal como llega en el listado: el rol, con la identidad al lado. */
export interface CheckingAccountPartyRoleRef {
  uuid: string;
  name: string | null;
  docType: string | null;
  docNumber: string | null;
  /** `CUSTOMER` o `SUPPLIER`. Decide los carteles, no la aritmética (§3.1). */
  role: PartyRole | null;
}

/**
 * Una fila del listado, **tal como la devuelve `POST /checking-account/paginate`**.
 *
 * Es más chica que {@link CheckingAccountListItemDto}, que es la del prototipo en memoria: el
 * disponible y el nivel de morosidad todavía no existen en el backend —llegan con las políticas y la
 * morosidad manual— y por eso la pantalla no los muestra. Cuando lleguen, se agregan acá y en la
 * tabla; mientras tanto, mostrar un cero o un guion sería inventar un dato.
 */
export interface CheckingAccountRowDto {
  uuid: string;
  partyRoleUuid: string;
  partyRole: CheckingAccountPartyRoleRef | null;
  /** Identidad detrás del rol: las dos cuentas del mismo tercero comparten este uuid. */
  partyUuid: string | null;
  /** Σ deudas pendientes − Σ créditos sin imputar. Positivo = el titular debe. */
  balance: number | null;

  /**
   * Los dos términos de los que sale {@link balance}: la deuda abierta y la plata sin imputar.
   *
   * **Sólo llegan en la lectura de una cuenta**, no en el paginado — ahí viajan nulos, y nulo es «no
   * se calculó en esta vista», que es distinto de cero. La ficha los usa para avisar cuando los dos
   * son distintos de cero: con imputación manual un saldo a favor puede convivir con una factura
   * impaga, y la resta sola se lee como que no se debe nada.
   */
  pendingAmount?: number | null;
  unallocatedAmount?: number | null;
  /**
   * Σ pendiente de las deudas ya vencidas. Lo calcula el backend en cada lectura —una deuda vence
   * sola al pasar la fecha—, así que la pantalla no deriva nada: lo pinta.
   */
  overdueAmount: number | null;
  /**
   * Hace cuántos días venció la deuda más antigua que sigue impaga. **Nulo si no hay nada vencido**
   * — cero se leería como «venció hoy», que es otra cosa.
   *
   * Va junto a {@link overdueAmount} porque son la misma pregunta partida en dos: el importe dice
   * cuánto, esto dice desde cuándo. Con uno solo, $84.000 vencidos ayer y $84.000 vencidos hace
   * siete meses se leen igual, y son decisiones distintas.
   */
  oldestOverdueDays: number | null;
  /**
   * `AL_DIA | EN_MORA | MOROSO | MOROSO_GRAVE`. Lo fija una persona con motivo y **no hace nada**:
   * ninguno de los cuatro bloquea una venta ni deshabilita un medio de pago.
   */
  delinquencyLevel: DelinquencyLevel;
  /** Kill switch por titular: apagada, el medio «cuenta corriente» no se ofrece. */
  enabled: boolean;
  /**
   * Cuándo se recalculó el saldo por última vez.
   *
   * El saldo es un **cache** de la suma de las partidas, y esto es lo único que dice desde cuándo lo
   * es. La verificación lo sella aunque no encuentre ninguna diferencia: la fecha contesta «esto se
   * miró», que es distinto de «esto está bien».
   */
  balanceRecalculatedAt?: string | null;
  version: number;
}

/** El cuerpo de `POST /checking-account/save`: lo único que la ficha edita es el kill switch. */
export interface SaveAccountRequest {
  uuid: string;
  enabled: boolean;
  version: number;
}

/**
 * Una fila del extracto, **tal como la devuelve `POST /checking-account/{uuid}/statement`**.
 *
 * El extracto es una consulta y no una tabla: el backend une deudas y créditos en una sola lista
 * cronológica y resuelve el saldo acumulado con una ventana sobre el extracto **entero**, no sobre
 * la página. Por eso el `runningBalance` de la última fila del listado completo es el saldo de la
 * cuenta, y por eso la pantalla no acumula nada por su cuenta.
 */
export interface StatementEntryRowDto {
  /**
   * De qué lado está la fila, y con eso cómo leer el resto.
   *
   * `DEBT` y `CREDIT` son partidas. `DEBT_VOID` y `CREDIT_VOID` son **sus anulaciones**, con la
   * fecha en que se anularon y el signo contrario: la partida conserva su importe en su fecha
   * original, así que el saldo acumulado de los meses del medio ya no cambia cuando alguien anula
   * algo viejo. `ALLOCATION` y `REVERSAL` son el acto de aplicar esa plata a una deuda y el de
   * deshacerlo: no mueven el saldo —redistribuyen lo que ya entró— pero sin ellos se ve entrar la
   * deuda, se ve entrar el cobro y no se ve lo que los une. Las cuatro restantes son **hechos de la
   * cuenta** que tampoco mueven el saldo pero sí explican lo que se ve: por qué alguien dejó de
   * reclamarle a un cliente, por qué un vencido cayó de un día para el otro.
   */
  entryType:
    | 'DEBT'
    | 'CREDIT'
    | 'DEBT_VOID'
    | 'CREDIT_VOID'
    | 'ALLOCATION'
    | 'REVERSAL'
    | 'DELINQUENCY'
    | 'EXTENSION'
    | 'NOTICE'
    | 'POLICY';
  uuid: string;
  publicId: string | null;
  origin: string | null;
  description: string | null;
  /** Derivado y evaluado contra la fecha de hoy: los de `DebtStates` o los de `CreditStates`. */
  state: string | null;
  dateIssued: string;
  dateVoided: string | null;
  /** Importe original de la partida, siempre positivo. Nulo en las filas que no son partidas. */
  amount: number | null;
  /** El vencimiento que la fila afirma: el de la deuda, o el que dejó vigente una prórroga. */
  dateDue?: string | null;
  /** Sólo en un `EXTENSION`: el vencimiento que la deuda tenía antes. */
  previousDateDue?: string | null;
  /**
   * Quién dejó esta fila, cuando se sabe. Es un **nombre** y no un uuid: el extracto se lee, no se
   * navega. Viaja nulo en las partidas que nadie firmó —las de una venta, que las emite el commit—,
   * y eso también informa: las que tienen autor son las que alguien decidió a mano.
   */
  userName?: string | null;
  /**
   * Lo que esta fila le mueve al saldo: `+amount` si es deuda, `−amount` si es crédito, y **cero si
   * está anulada** — se sigue mostrando, porque la anulación es parte de la historia, pero ya no pesa.
   */
  signedAmount: number;
  /** El saldo de la cuenta después de esta partida. */
  runningBalance: number;
}

/** Una deuda tal como la devuelve `POST /checking-account/{uuid}/debts`. */
export interface CheckingAccountDebtRowDto {
  uuid: string;
  accountUuid: string | null;
  publicId: string | null;
  origin: string | null;
  /**
   * `PENDIENTE` | `PARCIAL` | `VENCIDA` | `PAGADA` | `ANULADA`, **derivado por el backend** contra la
   * fecha de hoy. La pantalla lo pinta y no lo recalcula: si lo derivara acá, un reloj corrido en la
   * máquina del operador mostraría un estado distinto del que el sistema usa para decidir.
   *
   * No es nullable: el estado sale de un `CASE` que siempre cae en una rama.
   */
  state: DebtState;
  amount: number;
  pendingAmount: number;
  dateIssued: string;
  dateDue: string;
  /** El primero. Distinto de `dateDue` significa que la deuda fue prorrogada. */
  dateDueOriginal: string | null;
  dateVoided: string | null;
  description: string | null;
  /**
   * La operación que la emitió, cuando salió de una. Nula en un ajuste y en un saldo inicial, que
   * son las dos formas de que exista una deuda sin comprobante detrás.
   *
   * Es lo que permite volver de la deuda a la venta o a la compra que la generó: el `name` es el
   * número visible, y con él la pantalla de operaciones abre buscando ese comprobante.
   */
  order: { uuid: string; name: string | null } | null;
}

/**
 * Una prórroga: el vencimiento se corrió de una fecha a otra, y alguien dijo por qué.
 *
 * **Guarda de dónde venía y no se infiere de la fila anterior.** Con dos prórrogas encadenadas, leer
 * «el anterior» de la de más abajo funciona; con una sola, o con la lista filtrada, no hay fila
 * anterior de la que sacarlo.
 */
export interface DebtExtensionRowDto {
  uuid: string;
  accountUuid: string | null;
  debtUuid: string;
  debtPublicId: string | null;
  previousDue: string;
  newDue: string;
  reason: string | null;
  dateDecided: string;
}

/** El cuerpo de `/statement` y `/debts`: sólo página, y lo que cada uno acepta además. */
export interface LedgerQuery {
  /** Empieza en 1, como el resto de los paginados. */
  page: number;
  size: number;
  /** Sólo `/statement`. Por defecto el backend incluye las anuladas. */
  includeVoided?: boolean;
  /** Sólo `/debts`. Vacío trae las abiertas: `PENDIENTE`, `PARCIAL` y `VENCIDA`. */
  states?: readonly string[];
}

/**
 * Un cobro o un pago **tal como lo devuelve el backend**: `POST /checking-account/credit`, su
 * `paginate` y su ficha por uuid.
 *
 * Más chico que el `CheckingAccountCreditDto` del prototipo: no trae nada de políticas ni de
 * morosidad, que son de la entrega siguiente.
 */
export interface CheckingAccountCreditRowDto {
  uuid: string;
  accountUuid: string | null;
  /** Quién es el titular. Lo resuelve el backend con una sola consulta para la página entera. */
  partyRole: CheckingAccountPartyRoleRef | null;
  /** Hoy siempre nulo en un cobro: numerar el recibo es una decisión con alcance propio. */
  publicId: string | null;
  origin: CreditOrigin;
  /** `ANULADO | IMPUTADO | PARCIAL | SIN_IMPUTAR`, derivado por el backend. */
  state: CreditState;
  amount: number;
  /**
   * Lo que todavía no cancela ninguna deuda. **Ya es el sobrante**: el alta dispara la imputación
   * automática, así que un cobro con deudas abiertas vuelve con esto en cero.
   */
  unallocatedAmount: number;
  /** `false` = alguien lo desimputó a mano y esa plata espera; el FIFO no lo toca. */
  autoAllocate: boolean;
  dateIssued: string;
  dateVoided: string | null;
  voidReason: string | null;
  description: string | null;
  branch: UuidNameRef | null;
  cashRegister: UuidNameRef | null;
  /** Sólo en la ficha y en la respuesta del alta; el paginado no los trae. */
  payments?: readonly CreditPaymentRowDto[];
  /** Ídem: qué deudas canceló este cobro. */
  allocations?: readonly CheckingAccountAllocationRowDto[];
}

export interface UuidNameRef {
  uuid: string;
  name: string;
}

/** Un medio con el que entró un cobro. */
export interface CreditPaymentRowDto {
  uuid: string;
  paymentMethod: UuidNameRef | null;
  amount: number;
  /** Snapshot del medio al momento del cobro: si después cambia de criterio, esto no cambia. */
  affectsCashRegister: boolean;
}

/** Una fila del libro de imputaciones, tal como la devuelve el backend. */
export interface CheckingAccountAllocationRowDto {
  uuid: string;
  /** Cuándo se escribió. Es el orden de la línea de tiempo: la cadena avanza en el tiempo. */
  dateCreated: string;
  entryType: 'ALLOCATION' | 'REVERSAL';
  amount: number;
  /** `+amount` en una imputación, `−amount` en una reversión. Lo calcula la base. */
  signedAmount: number;
  cause: 'MANUAL' | 'REASSIGN' | 'CREDIT_VOID' | 'DEBT_VOID';
  /** `AUTOMATIC` = lo decidió el FIFO; `MANUAL` = una persona. */
  mode: AllocationMode;
  reason: string | null;
  debtUuid: string | null;
  debtPublicId: string | null;
  creditUuid: string | null;
  creditPublicId: string | null;
  reversesUuid: string | null;
  originUuid: string | null;
}

/**
 * Qué haría la imputación automática con un importe, **antes** de cobrarlo.
 *
 * Lo calcula la misma función del backend que después escribe las filas, así que la previa coincide
 * con lo que queda imputado por construcción y no porque alguien mantenga dos implementaciones
 * sincronizadas. Es una foto, no una reserva: nada queda bloqueado.
 */
export interface AllocationPreviewDto {
  amount: number;
  /** Cuánto del importe cancela deuda. */
  allocatedAmount: number;
  /** Lo que quedaría a favor del titular por no haber deuda abierta que lo absorba. */
  surplusAmount: number;
  lines: readonly AllocationPreviewLineDto[];
}

export interface AllocationPreviewLineDto {
  debtUuid: string;
  publicId: string | null;
  description: string | null;
  dateDue: string;
  /** Lo que la deuda debe hoy. */
  pendingAmount: number;
  /** Cuánto del cobro se le aplicaría. */
  amount: number;
  /** Lo que quedaría debiendo. En cero, la deuda queda saldada. */
  remainingAmount: number;
}

/** El cuerpo de `POST /checking-account/credit/preview`. */
export interface PreviewAllocationRequest {
  accountUuid?: string;
  partyRoleUuid?: string;
  amount: number;
}

/**
 * El cuerpo de `POST /checking-account/credit`.
 *
 * **No lleva `amount`**: el importe del cobro es la suma de sus medios, y el backend lo deriva.
 * Mandarlo aparte abriría la única forma de que un cobro diga que entraron $100.000 mientras sus
 * medios suman $90.000.
 */
export interface RegisterCreditRequest {
  accountUuid?: string;
  partyRoleUuid?: string;
  /** Obligatorio **sólo** si algún medio afecta caja. */
  cashRegisterUuid?: string;
  /** Fecha contable. Ausente = ahora. Es la que decide qué sesión de caja cubre el cobro. */
  dateIssued?: string;
  description?: string;
  payments: readonly RegisterCreditPaymentInput[];
  /**
   * Contra qué deudas aplicar el cobro, cuando quien cobra ya sabe cuáles.
   *
   * **Su ausencia no significa «no imputar»**: sin esta lista corre el FIFO. Con ella el FIFO no
   * corre, el reparto es el que vino y lo que sobre queda a favor del titular. Viaja en el mismo
   * request porque cobrar primero y corregir después deja al FIFO aplicar la plata en el medio.
   */
  allocations?: readonly AllocationInput[];
}

export interface RegisterCreditPaymentInput {
  paymentMethodUuid: string;
  amount: number;
}

/** Un medio del catálogo, con lo único que la pantalla de cobro necesita saber de él. */
export interface PaymentMethodOption {
  uuid: string;
  name: string;
  code: string | null;
  affectsCashRegister: boolean;
}

/** El cuerpo de `POST /checking-account/credit/{uuid}/allocate`. */
export interface AllocateRequest {
  allocations: readonly AllocationInput[];
}

export interface AllocationInput {
  debtUuid: string;
  amount: number;
}

/**
 * El cuerpo de `POST /checking-account/allocation/{uuid}/reverse`.
 *
 * `amount` es opcional: sin él se revierte todo lo que le queda vigente a la imputación, que es lo
 * que hace el botón «deshacer». El motivo **no** lo es — es la única respuesta a por qué esta plata
 * dejó de estar donde estaba.
 */
export interface ReverseRequest {
  amount?: number;
  reason: string;
}

/**
 * El cuerpo de `POST /checking-account/adjustment`.
 *
 * `direction` es del lado del **saldo** y no de la tabla: `DEBIT` lo sube —nace una deuda— y
 * `CREDIT` lo baja. Que la palabra sea ésa es lo que hace que el mismo request signifique lo
 * correcto en una cuenta de cliente y en una de proveedor.
 */
export interface AdjustmentRequest {
  accountUuid?: string;
  partyRoleUuid?: string;
  direction: AdjustmentDirection;
  /** Siempre positivo: el sentido lo dice `direction` y no el signo. */
  amount: number;
  /**
   * Sólo en un `DEBIT`, y opcional: sin fecha rige la que propone la política del titular. Mandarla
   * en un `CREDIT` es un 400 — un crédito no vence.
   */
  dateDue?: string;
  reason: string;
}

export type AdjustmentDirection = 'DEBIT' | 'CREDIT';

/**
 * Lo que devuelve el ajuste: la partida que se emitió y el saldo con el que quedó la cuenta.
 *
 * El saldo viene en la respuesta porque es la pregunta siguiente inevitable —quien ajusta lo hace
 * para llevar la cuenta a un número—, así que la pantalla no necesita una segunda llamada para
 * confirmar que llegó.
 */
export interface AdjustmentResultDto {
  entryType: 'DEBT' | 'CREDIT';
  uuid: string;
  accountUuid: string;
  origin: string;
  amount: number;
  dateIssued: string;
  dateDue: string | null;
  reason: string;
  balance: number;
}

/**
 * El cuerpo de `POST /checking-account/debt/{uuid}/extend`.
 *
 * Los dos campos son obligatorios y el vencimiento tiene que ir hacia adelante: adelantarlo no es
 * prorrogar, es exigir el pago antes de lo pactado.
 */
export interface ExtendDebtRequest {
  dateDue: string;
  reason: string;
}

/**
 * Lo que encontró una verificación de consistencia.
 *
 * `discrepancies` en cero es el resultado normal, y por eso viene también `accountsChecked`: «no
 * encontré nada» y «no miré nada» se leen igual si ese número no está.
 */
export interface ConsistencyReportDto {
  accountsChecked: number;
  discrepancies: number;
  balanceDiscrepancies: number;
  delinquencyDiscrepancies: number;
  found: readonly ConsistencyDiscrepancyDto[];
}

/** Una diferencia entre un cache y su derivación: qué decía y qué dicen las filas. */
export interface ConsistencyDiscrepancyDto {
  uuid: string;
  accountUuid: string;
  /**
   * El titular, resuelto por el backend para que la lista se lea sin abrir cada cuenta. Nulo si la
   * cuenta perdió su rol, que es en sí una anomalía y por eso no se esconde.
   */
  partyRole?: UuidNameRef | null;
  /** `BALANCE` (invariante 3) o `DELINQUENCY` (invariante 4). */
  invariantCode: 'BALANCE' | 'DELINQUENCY';
  cachedValue: string;
  derivedValue: string;
  /** Sólo en `BALANCE`: entre dos niveles no hay resta que hacer. */
  difference: number | null;
  dateDetected: string;
  resolvedAt: string | null;
}

/**
 * La trazabilidad de una imputación: las cinco preguntas de §8.4 en una respuesta.
 *
 * El recorrido viene **aplanado por nivel** y no como árbol, porque cada salto va siempre hacia
 * adelante en el tiempo —de una imputación a la reversión que la deshizo, y de ésa a la que la
 * reversión financió—, así que ordenar por `depth` ya es ordenar cronológicamente.
 */
export interface AllocationTraceDto {
  /** La fila consultada. */
  allocation: CheckingAccountAllocationRowDto;
  /** Σ de lo revertido sobre ella. */
  reversedAmount: number;
  /** `amount − reversedAmount`: lo que esta imputación todavía sostiene. */
  activeAmount: number;
  /** `activeAmount > 0`. Una reversión nunca es «vigente»: es lo que deshace. */
  active: boolean;
  /** Las reversiones que la apuntan, con su causa y su motivo. */
  reversals: readonly CheckingAccountAllocationRowDto[];
  /** El recorrido hacia adelante, un paso por salto. `depth: 0` es la fila consultada. */
  trace: readonly AllocationTraceStepDto[];
  /** Cómo llegó la deuda a su pendiente: sus filas en orden cronológico. */
  debtHistory: readonly CheckingAccountAllocationRowDto[];
}

export interface AllocationTraceStepDto {
  /** Cuántos saltos hay desde la fila consultada. */
  depth: number;
  entry: CheckingAccountAllocationRowDto;
}

/**
 * El aviso de deuda **propuesto**: a quién iría, con qué texto y con qué detalle.
 *
 * Es una propuesta, no un aviso. El backend arma la parte tediosa —qué comprobantes, por cuánto,
 * hace cuántos días— y la persona decide si eso es lo que corresponde decirle a este cliente hoy.
 */
export interface NoticePreviewDto {
  accountUuid: string;
  partyName: string;
  /** Nulo cuando el tercero no tiene mail cargado: la pantalla pide uno en vez de mandar al vacío. */
  recipient: string | null;
  subject: string;
  /** El texto propuesto, en HTML. Es lo que el operador ve y edita. */
  body: string;
  overdueAmount: number;
  /** Las deudas vencidas que el aviso detalla. Vacío = no hay nada vencido. */
  debts: readonly CheckingAccountDebtRowDto[];
}

/**
 * El cuerpo de `POST /checking-account/{uuid}/notice`.
 *
 * El texto viaja completo: el operador ve exactamente lo que va a salir y puede cambiarlo. El
 * servidor propone en `/notice/preview` y no vuelve a opinar.
 */
export interface SendNoticeRequest {
  /** Opcional: sin dirección se usa el mail del tercero. */
  recipient?: string;
  subject: string;
  body: string;
}

/** Un aviso ya mandado. */
export interface NoticeDto {
  uuid: string;
  accountUuid: string;
  recipient: string;
  subject: string;
  /** Sólo en la lectura de a uno: el paginado no arrastra el HTML de cada mail. */
  body?: string | null;
  overdueAmount: number;
  overdueDebts: number;
  dateSent: string;
}

/**
 * El cuerpo de `POST /checking-account/credit/{uuid}/void`.
 *
 * Un solo campo, y obligatorio: es la operación de más impacto del módulo —le devuelve plata a la
 * caja y le vuelve a poner la deuda encima al cliente—, así que lo único que va a explicar por qué un
 * recibo dejó de valer es esta frase.
 */
export interface VoidCreditRequest {
  reason: string;
}

/**
 * Qué pasaría al anular un cobro, calculado por el backend.
 *
 * Existe por lo mismo que la previa de la desimputación, y con más razón: anular no deshace un
 * vínculo, deshace **el ingreso de dinero**. Los estados los deriva el servidor —se evalúan contra
 * la fecha de hoy—, así que la pantalla los pinta y no los recalcula.
 */
export interface VoidPreviewDto {
  creditUuid: string;
  publicId: string | null;
  /** Importe del cobro: exactamente lo que va a subir el saldo. */
  amount: number;
  /**
   * Lo que sale de la caja. **Puede ser menor que `amount`** —un cobro mitad efectivo y mitad
   * transferencia mueve caja sólo por la mitad—, y por eso es un número aparte.
   */
  cashAmount: number;
  balance: number;
  /** Sube por el importe entero: vuelve la deuda que ese dinero había cancelado. */
  balanceAfter: number;
  /** Vacío significa que el cobro estaba sin imputar: se anula igual. */
  lines: readonly VoidPreviewLineDto[];
}

/** Una deuda que vuelve a quedar impaga, con el estado en el que queda. */
export interface VoidPreviewLineDto {
  debtUuid: string;
  debtPublicId: string | null;
  debtDescription: string | null;
  /** Lo que la anulación le devuelve a esta deuda. */
  amount: number;
  pendingAmount: number;
  pendingAmountAfter: number;
  state: DebtState;
  /** El estado en el que queda. Es el dato por el que esta previa existe. */
  stateAfter: DebtState;
}

/** El cuerpo de `POST /checking-account/allocation/{uuid}/reassign`. */
export interface ReassignRequest {
  debtUuid: string;
  amount?: number;
  reason: string;
}

/**
 * El antes y el después de desimputar, calculado por el backend.
 *
 * **El estado de la deuda lo deriva el servidor**, no la pantalla: se evalúa contra la fecha de hoy,
 * y un reloj corrido en la máquina del operador mostraría un aviso que el sistema no comparte.
 *
 * **No informa el saldo de la cuenta y no es un olvido:** desimputar no lo mueve. La deuda vuelve a
 * pendiente y el cobro vuelve a disponible por el mismo importe. Lo que cambia es la composición, y
 * con ella el saldo vencido — que es exactamente lo que el diálogo tiene que mostrar.
 */
export interface ReversePreviewDto {
  amount: number;
  /** Lo que le queda vigente a la imputación hoy, y lo que le quedaría después. */
  activeAmount: number;
  activeAmountAfter: number;
  debtUuid: string;
  debtPublicId: string | null;
  debtDescription: string | null;
  debtPendingAmount: number;
  debtPendingAmountAfter: number;
  debtState: DebtState;
  /** Que pase de `PAGADA` a `VENCIDA` es lo que hay que avisar antes de confirmar. */
  debtStateAfter: DebtState;
  creditUnallocatedAmount: number;
  creditUnallocatedAmountAfter: number;
}

/* ────────────────────────────  Derivaciones  ──────────────────────────── */

/**
 * La aritmética de fechas de calendario vive en `core`: el mismo `YYYY-MM-DD` lo usan la vigencia de
 * una promoción y el vencimiento de una deuda, y el bug de leer la fecha como UTC es el mismo.
 */
export { addDays, daysBetween, parseIsoDate, toIsoDate, todayIso } from '../../../core/date/iso-date';

/**
 * §7.1 — el estado sale de tres datos que ya están en la fila, y el orden de evaluación es parte
 * de la regla: una deuda anulada no se informa vencida, y una pagada tampoco, aunque su
 * vencimiento haya quedado atrás.
 */
export function debtState(debt: CheckingAccountDebtDto, today = todayIso()): DebtState {
  if (debt.dateVoided) {
    return 'ANULADA';
  }
  if (debt.pendingAmount <= 0) {
    return 'PAGADA';
  }
  if (daysBetween(debt.dateDue, today) > 0) {
    return 'VENCIDA';
  }
  if (debt.pendingAmount < debt.amount) {
    return 'PARCIAL';
  }
  return 'PENDIENTE';
}

/** Días vencidos de una deuda: 0 mientras no haya pasado su vencimiento. */
export function overdueDays(debt: CheckingAccountDebtDto, today = todayIso()): number {
  if (debt.dateVoided || debt.pendingAmount <= 0) {
    return 0;
  }
  return Math.max(0, daysBetween(debt.dateDue, today));
}

/** Una deuda prorrogada conserva su vencimiento original al lado del nuevo (§6). */
export function isExtended(debt: CheckingAccountDebtDto): boolean {
  return debt.dateDue !== debt.dateDueOriginal;
}

export function creditState(credit: CheckingAccountCreditDto): CreditState {
  if (credit.dateVoided) {
    return 'ANULADO';
  }
  if (credit.unallocatedAmount <= 0) {
    return 'IMPUTADO';
  }
  if (credit.unallocatedAmount < credit.amount) {
    return 'PARCIAL';
  }
  return 'SIN_IMPUTAR';
}

/**
 * §9.1 — el nivel se evalúa con dos criterios y **gana el peor**: antigüedad de la deuda vencida
 * más vieja, y exposición (importe vencido como porcentaje del límite). Una excepción vigente pisa
 * el cálculo; una vencida deja de aplicar sola, sin que nadie la levante (§9.2).
 */
export function delinquencyLevel(
  account: Pick<
    CheckingAccountDto,
    'overdueAmount' | 'oldestOverdueDays' | 'delinquencyException' | 'policy'
  >,
  today = todayIso(),
): DelinquencyLevel {
  const exception = account.delinquencyException;
  if (exception && daysBetween(exception.dateUntil, today) <= 0) {
    return exception.level;
  }

  const byAge = levelByAge(account.oldestOverdueDays);
  const byExposure = levelByExposure(account.overdueAmount, account.policy.debtLimit.value);
  return worstLevel(byAge, byExposure);
}

const LEVEL_ORDER: readonly DelinquencyLevel[] = ['AL_DIA', 'EN_MORA', 'MOROSO', 'MOROSO_GRAVE'];

export function worstLevel(a: DelinquencyLevel, b: DelinquencyLevel): DelinquencyLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b;
}

function levelByAge(days: number): DelinquencyLevel {
  if (days <= 0) {
    return 'AL_DIA';
  }
  if (days <= 15) {
    return 'EN_MORA';
  }
  return days <= 60 ? 'MOROSO' : 'MOROSO_GRAVE';
}

function levelByExposure(overdueAmount: number, debtLimit: number | null): DelinquencyLevel {
  if (overdueAmount <= 0 || !debtLimit || debtLimit <= 0) {
    return 'AL_DIA';
  }
  const ratio = overdueAmount / debtLimit;
  if (ratio > 1) {
    return 'MOROSO_GRAVE';
  }
  return ratio > 0.5 ? 'MOROSO' : 'AL_DIA';
}

/**
 * Lo que queda por consumir del límite. Un saldo a favor no consume límite, así que el disponible
 * de una cuenta en negativo es el límite entero más el saldo a favor (§16, «Límites»).
 */
export function availableAmount(balance: number, debtLimit: number | null): number | null {
  if (debtLimit === null) {
    return null;
  }
  return debtLimit - balance;
}

/** Porcentaje del límite ya consumido, acotado a [0, 100]; `null` sin límite. */
export function limitUsageRatio(balance: number, debtLimit: number | null): number | null {
  if (!debtLimit || debtLimit <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((balance / debtLimit) * 100)));
}

/** Un saldo negativo es saldo **a favor del titular**; la UI lo dice, no lo muestra en rojo. */
export function isCreditBalance(balance: number): boolean {
  return balance < 0;
}
