import { Service, inject } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import {
  AccountAvailabilityDto,
  AllocationMode,
  CheckingAccountAllocationDto,
  CheckingAccountCreditDto,
  CheckingAccountDebtDto,
  CheckingAccountDto,
  CheckingAccountListItemDto,
  CheckingAccountsSummaryDto,
  CollectionListItemDto,
  DelinquencyException,
  PartyRef,
  PartyRole,
  PolicySource,
  ResolvedPolicy,
  ResolvedPolicyValue,
  StatementEntryDto,
  addDays,
  availableAmount,
  daysBetween,
  debtState,
  delinquencyLevel,
  overdueDays,
  todayIso,
} from './checking-account.model';
import {
  ACCOUNT_SEEDS,
  AccountSeed,
  COMPANY_POLICY,
  DEFAULT_POLICY,
  PAYMENT_METHOD_SEEDS,
  PolicyValues,
} from './checking-accounts.seed';

/** Lo que el alta de cobro le manda a `POST /checking-account/credit` (§15). */
export interface RegisterCreditPayload {
  accountUuid: string;
  dateIssued: string;
  amount: number;
  payments: readonly { paymentMethodUuid: string; amount: number }[];
  /** Pisa la política **para este cobro**, sin cambiar la de nadie (§16, «Imputación»). */
  allocationMode: AllocationMode;
  /** Imputaciones explícitas; sólo se miran en modo manual. */
  allocations?: readonly { debtUuid: string; amount: number }[];
  notes?: string;
}

/** Una línea de la vista previa FIFO que el alta muestra antes de confirmar. */
export interface AllocationPreviewLine {
  debtUuid: string;
  debtPublicId: string;
  dateDue: string;
  pendingAmount: number;
  appliedAmount: number;
  remainingAmount: number;
}

export interface AllocationPreview {
  lines: readonly AllocationPreviewLine[];
  /** Lo que queda a favor del titular después de imputar todo lo que se puede. */
  unallocatedAmount: number;
}

interface MockAccountRow {
  uuid: string;
  party: PartyRef;
  role: PartyRole;
  enabled: boolean;
  policyOverride: Partial<PolicyValues>;
  exception: DelinquencyException | null;
}

export class MockApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MockApiError';
  }
}

/**
 * El almacén en memoria detrás del módulo: es lo único que hace de base de datos mientras los
 * endpoints de §15 no existan.
 *
 * Guarda **partidas**, no saldos. El saldo de una cuenta, su importe vencido, su cantidad de deudas
 * abiertas y su nivel de morosidad se recalculan cada vez que se los pide, sumando deudas y
 * créditos vivos: es la forma barata de que los tres invariantes de §4.3 sigan valiendo después de
 * cobrar, imputar, desimputar, anular o compensar desde la pantalla, sin un `balance` que pueda
 * quedar desfasado de sus partidas.
 *
 * Es singleton a propósito: lo que se cobra en «Registrar cobro» tiene que estar en el extracto
 * cuando se navega a la ficha, no volver a la semilla en cada montaje.
 */
@Service()
export class CheckingAccountsMockDb {
  private readonly auth = inject(AuthService);

  private readonly accounts: MockAccountRow[] = [];
  private readonly debts: CheckingAccountDebtDto[] = [];
  private readonly credits: CheckingAccountCreditDto[] = [];
  private readonly allocations: CheckingAccountAllocationDto[] = [];

  private sequence = 0;
  private receiptSequence = 200;

  readonly paymentMethods = PAYMENT_METHOD_SEEDS;

  constructor() {
    ACCOUNT_SEEDS.forEach((seed) => this.loadSeed(seed));
  }

  /* ──────────────────────────────  Lecturas  ────────────────────────────── */

  listAccounts(): CheckingAccountListItemDto[] {
    return this.accounts.map((row) => this.toListItem(row));
  }

  getAccount(uuid: string): CheckingAccountListItemDto {
    const row = this.accounts.find((account) => account.uuid === uuid);
    if (!row) {
      throw new MockApiError('ACCOUNT_NOT_FOUND', `No existe la cuenta ${uuid}`);
    }
    return this.toListItem(row);
  }

  listDebts(accountUuid: string): CheckingAccountDebtDto[] {
    return this.debts
      .filter((debt) => debt.accountUuid === accountUuid)
      .map((debt) => ({ ...debt }))
      .sort((a, b) => a.dateDue.localeCompare(b.dateDue));
  }

  /** Las deudas que todavía pueden recibir imputación, en el orden FIFO de §8.1. */
  listOpenDebts(accountUuid: string): CheckingAccountDebtDto[] {
    return this.debts
      .filter(
        (debt) => debt.accountUuid === accountUuid && !debt.dateVoided && debt.pendingAmount > 0,
      )
      .map((debt) => ({ ...debt }))
      .sort(
        (a, b) => a.dateDue.localeCompare(b.dateDue) || a.dateIssued.localeCompare(b.dateIssued),
      );
  }

  listCredits(accountUuid: string): CheckingAccountCreditDto[] {
    return this.credits
      .filter((credit) => credit.accountUuid === accountUuid)
      .map((credit) => ({ ...credit }))
      .sort((a, b) => b.dateIssued.localeCompare(a.dateIssued));
  }

  listUnallocatedCredits(accountUuid: string): CheckingAccountCreditDto[] {
    return this.listCredits(accountUuid).filter(
      (credit) => !credit.dateVoided && credit.unallocatedAmount > 0,
    );
  }

  listAllocations(accountUuid: string): CheckingAccountAllocationDto[] {
    return this.allocations
      .filter((allocation) => allocation.accountUuid === accountUuid)
      .map((allocation) => ({ ...allocation }))
      .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated));
  }

  /**
   * El extracto: deudas y créditos en una sola línea de tiempo, con el saldo acumulado calculado
   * **al recorrerla**, no guardado. Las partidas anuladas se listan sin sumar: el extracto es un
   * registro de lo que pasó, y una anulación es parte de lo que pasó.
   */
  statement(accountUuid: string): StatementEntryDto[] {
    const rows: Omit<StatementEntryDto, 'runningBalance'>[] = [
      ...this.debts
        .filter((debt) => debt.accountUuid === accountUuid)
        .map((debt) => ({
          uuid: debt.uuid,
          date: debt.dateIssued,
          kind: 'DEBT' as const,
          origin: debt.origin,
          publicId: debt.publicId,
          description: debt.description,
          debitAmount: debt.amount,
          creditAmount: null,
          voided: debt.dateVoided !== null,
        })),
      ...this.credits
        .filter((credit) => credit.accountUuid === accountUuid)
        .map((credit) => ({
          uuid: credit.uuid,
          date: credit.dateIssued,
          kind: 'CREDIT' as const,
          origin: credit.origin,
          publicId: credit.publicId,
          description: credit.description,
          debitAmount: null,
          creditAmount: credit.amount,
          voided: credit.dateVoided !== null,
        })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.publicId.localeCompare(b.publicId));

    let running = 0;
    return rows.map((row) => {
      if (!row.voided) {
        running += (row.debitAmount ?? 0) - (row.creditAmount ?? 0);
      }
      return { ...row, runningBalance: running };
    });
  }

  listCollections(): CollectionListItemDto[] {
    return this.credits
      .map((credit) => {
        const account = this.accounts.find((row) => row.uuid === credit.accountUuid);
        return {
          uuid: credit.uuid,
          accountUuid: credit.accountUuid,
          partyName: account?.party.name ?? '—',
          role: account?.role ?? 'CUSTOMER',
          publicId: credit.publicId,
          origin: credit.origin,
          dateIssued: credit.dateIssued,
          amount: credit.amount,
          unallocatedAmount: credit.unallocatedAmount,
          dateVoided: credit.dateVoided,
          paymentSummary:
            credit.payments.map((payment) => payment.paymentMethodName).join(' + ') || '—',
        };
      })
      .sort((a, b) => b.dateIssued.localeCompare(a.dateIssued));
  }

  getCredit(uuid: string): CheckingAccountCreditDto {
    const credit = this.credits.find((row) => row.uuid === uuid);
    if (!credit) {
      throw new MockApiError('CREDIT_NOT_FOUND', `No existe el crédito ${uuid}`);
    }
    return { ...credit };
  }

  summary(): CheckingAccountsSummaryDto {
    const today = todayIso();
    const accounts = this.listAccounts();
    const dueSoonDays = COMPANY_POLICY.dueSoonDays ?? DEFAULT_POLICY.dueSoonDays;

    const receivableTotal = accounts
      .filter((account) => account.role === 'CUSTOMER')
      .reduce((total, account) => total + Math.max(0, account.balance), 0);
    const payableTotal = accounts
      .filter((account) => account.role === 'SUPPLIER')
      .reduce((total, account) => total + Math.max(0, account.balance), 0);

    const dueSoonTotal = this.debts
      .filter((debt) => {
        if (debt.dateVoided || debt.pendingAmount <= 0) {
          return false;
        }
        const remaining = daysBetween(today, debt.dateDue);
        return remaining >= 0 && remaining <= 7;
      })
      .reduce((total, debt) => total + debt.pendingAmount, 0);

    const severelyDelinquentCount = accounts.filter(
      (account) => account.delinquency === 'MOROSO_GRAVE',
    ).length;

    return {
      receivableTotal,
      payableTotal,
      dueSoonTotal,
      dueSoonDays,
      severelyDelinquentCount,
      // El mock no guarda historia diaria: informa cuántas de esas cuentas cruzaron los 60 días en
      // la última semana, que es la lectura que la tarjeta promete.
      severelyDelinquentDelta: accounts.filter(
        (account) =>
          account.delinquency === 'MOROSO_GRAVE' &&
          account.oldestOverdueDays > 60 &&
          account.oldestOverdueDays <= 67,
      ).length,
    };
  }

  /** §15 `/availability`: la decisión ya resuelta, con sus motivos en orden (§10). */
  availability(accountUuid: string): AccountAvailabilityDto {
    const account = this.getAccount(accountUuid);
    const reasonKeys: string[] = [];
    let decision: AccountAvailabilityDto['decision'] = 'ALLOWED';
    let overridable = false;

    if (!account.enabled) {
      reasonKeys.push('checkingAccounts.availability.reasons.disabled');
      decision = 'BLOCKED';
    }

    if (account.delinquency === 'EN_MORA') {
      reasonKeys.push('checkingAccounts.availability.reasons.warnDelinquent');
      decision = decision === 'BLOCKED' ? decision : 'WARN';
    }
    if (account.delinquency === 'MOROSO') {
      reasonKeys.push('checkingAccounts.availability.reasons.delinquent');
      decision = 'BLOCKED';
      overridable = true;
    }
    if (account.delinquency === 'MOROSO_GRAVE') {
      reasonKeys.push('checkingAccounts.availability.reasons.severelyDelinquent');
      decision = 'BLOCKED';
      overridable = false;
    }

    const limit = account.policy.debtLimit.value;
    if (limit !== null && account.balance >= limit) {
      reasonKeys.push('checkingAccounts.availability.reasons.limitExceeded');
      decision = 'BLOCKED';
      overridable = account.delinquency === 'MOROSO_GRAVE' ? false : true;
    }

    const openDebtLimit = account.policy.openDebtLimit.value;
    if (openDebtLimit !== null && account.openDebtCount >= openDebtLimit) {
      reasonKeys.push('checkingAccounts.availability.reasons.openDebtLimit');
      decision = 'BLOCKED';
    }

    return {
      accountUuid,
      balance: account.balance,
      debtLimit: limit,
      availableAmount: account.availableAmount,
      openDebtCount: account.openDebtCount,
      openDebtLimit,
      delinquency: account.delinquency,
      decision,
      reasonKeys,
      overridable,
    };
  }

  /** §8.1 — FIFO por vencimiento: la deuda más vieja primero, y el remanente queda a favor. */
  previewAllocation(accountUuid: string, amount: number): AllocationPreview {
    let remaining = round(amount);
    const lines: AllocationPreviewLine[] = [];

    for (const debt of this.listOpenDebts(accountUuid)) {
      if (remaining <= 0) {
        break;
      }
      const applied = Math.min(remaining, debt.pendingAmount);
      remaining = round(remaining - applied);
      lines.push({
        debtUuid: debt.uuid,
        debtPublicId: debt.publicId,
        dateDue: debt.dateDue,
        pendingAmount: debt.pendingAmount,
        appliedAmount: applied,
        remainingAmount: round(debt.pendingAmount - applied),
      });
    }

    return { lines, unallocatedAmount: remaining };
  }

  /* ──────────────────────────────  Escrituras  ────────────────────────────── */

  registerCredit(payload: RegisterCreditPayload): CheckingAccountCreditDto {
    const account = this.getAccount(payload.accountUuid);
    if (payload.amount <= 0) {
      throw new MockApiError('INVALID_AMOUNT', 'El importe del cobro tiene que ser mayor a cero.');
    }

    const paymentsTotal = round(
      payload.payments.reduce((total, payment) => total + payment.amount, 0),
    );
    if (paymentsTotal !== round(payload.amount)) {
      throw new MockApiError(
        'PAYMENTS_MISMATCH',
        'Los medios de pago tienen que sumar exactamente el importe del cobro.',
      );
    }

    const credit: CheckingAccountCreditDto = {
      uuid: this.nextId('credit'),
      accountUuid: payload.accountUuid,
      origin: 'RECEIPT',
      publicId: this.nextReceiptPublicId(account.role),
      amount: round(payload.amount),
      unallocatedAmount: round(payload.amount),
      dateIssued: payload.dateIssued,
      dateVoided: null,
      voidReason: null,
      branchName: 'Sucursal Central',
      description: payload.notes?.trim() || defaultCreditDescription(account.role),
      payments: payload.payments.map((payment) => {
        const method = this.paymentMethods.find((row) => row.uuid === payment.paymentMethodUuid);
        return {
          paymentMethodName: method?.name ?? 'Otro',
          amount: round(payment.amount),
          affectsCashRegister: method?.affectsCashRegister ?? false,
        };
      }),
    };

    this.credits.push(credit);

    if (payload.allocationMode === 'AUTOMATIC') {
      this.applyFifo(credit);
    } else if (payload.allocations?.length) {
      this.applyAllocations(credit.uuid, payload.allocations, 'MANUAL');
    }

    return { ...credit };
  }

  /** §8.2 — imputación manual: importes propuestos pero editables, y nunca más que el saldo. */
  applyAllocations(
    creditUuid: string,
    items: readonly { debtUuid: string; amount: number }[],
    mode: AllocationMode = 'MANUAL',
  ): void {
    const credit = this.credits.find((row) => row.uuid === creditUuid);
    if (!credit) {
      throw new MockApiError('CREDIT_NOT_FOUND', `No existe el crédito ${creditUuid}`);
    }
    if (credit.dateVoided) {
      throw new MockApiError('CREDIT_VOIDED', 'Un cobro anulado no se puede imputar.');
    }

    const total = round(items.reduce((sum, item) => sum + item.amount, 0));
    if (total > credit.unallocatedAmount + 0.005) {
      throw new MockApiError(
        'ALLOCATION_EXCEEDS_CREDIT',
        'No se puede imputar más que el saldo sin imputar del cobro.',
      );
    }

    for (const item of items) {
      if (item.amount <= 0) {
        continue;
      }
      const debt = this.debts.find((row) => row.uuid === item.debtUuid);
      if (!debt) {
        throw new MockApiError('DEBT_NOT_FOUND', `No existe la deuda ${item.debtUuid}`);
      }
      // §8.3 — una imputación nunca cruza cuentas, ni siquiera entre las dos del mismo tercero.
      if (debt.accountUuid !== credit.accountUuid) {
        throw new MockApiError(
          'ALLOCATION_CROSSES_ACCOUNTS',
          'Una imputación no puede vincular partidas de cuentas distintas.',
        );
      }
      if (item.amount > debt.pendingAmount + 0.005) {
        throw new MockApiError(
          'ALLOCATION_EXCEEDS_DEBT',
          'No se puede imputar más que el saldo pendiente de la deuda.',
        );
      }

      const amount = round(item.amount);
      debt.pendingAmount = round(debt.pendingAmount - amount);
      credit.unallocatedAmount = round(credit.unallocatedAmount - amount);
      this.allocations.push({
        uuid: this.nextId('allocation'),
        accountUuid: credit.accountUuid,
        debtUuid: debt.uuid,
        debtPublicId: debt.publicId,
        creditUuid: credit.uuid,
        creditPublicId: credit.publicId,
        amount,
        mode,
        dateCreated: new Date().toISOString(),
        dateReversed: null,
        reverseReason: null,
        userName: this.currentUserName(),
      });
    }
  }

  /** §8.4 — desimputar devuelve exactamente los saldos anteriores y deja la traza a la vista. */
  reverseAllocation(allocationUuid: string, reason: string): void {
    const allocation = this.allocations.find((row) => row.uuid === allocationUuid);
    if (!allocation) {
      throw new MockApiError('ALLOCATION_NOT_FOUND', `No existe la imputación ${allocationUuid}`);
    }
    if (allocation.dateReversed) {
      throw new MockApiError('ALLOCATION_REVERSED', 'La imputación ya estaba revertida.');
    }
    if (!reason.trim()) {
      throw new MockApiError('REASON_REQUIRED', 'Desimputar exige un motivo.');
    }

    const debt = this.debts.find((row) => row.uuid === allocation.debtUuid);
    const credit = this.credits.find((row) => row.uuid === allocation.creditUuid);
    if (debt) {
      debt.pendingAmount = round(debt.pendingAmount + allocation.amount);
    }
    if (credit) {
      credit.unallocatedAmount = round(credit.unallocatedAmount + allocation.amount);
    }

    allocation.dateReversed = new Date().toISOString();
    allocation.reverseReason = reason.trim();
  }

  /* ──────────────────────────────  Internos  ────────────────────────────── */

  private applyFifo(credit: CheckingAccountCreditDto): void {
    const preview = this.previewAllocation(credit.accountUuid, credit.unallocatedAmount);
    this.applyAllocations(
      credit.uuid,
      preview.lines.map((line) => ({ debtUuid: line.debtUuid, amount: line.appliedAmount })),
      'AUTOMATIC',
    );
  }

  private toListItem(row: MockAccountRow): CheckingAccountListItemDto {
    const today = todayIso();
    const debts = this.debts.filter(
      (debt) => debt.accountUuid === row.uuid && !debt.dateVoided && debt.pendingAmount > 0,
    );
    const credits = this.credits.filter(
      (credit) => credit.accountUuid === row.uuid && !credit.dateVoided,
    );

    const pendingTotal = debts.reduce((total, debt) => total + debt.pendingAmount, 0);
    const unallocatedTotal = credits.reduce((total, credit) => total + credit.unallocatedAmount, 0);

    const overdue = debts.filter((debt) => debtState(debt, today) === 'VENCIDA');
    const overdueAmount = round(overdue.reduce((total, debt) => total + debt.pendingAmount, 0));
    const oldestOverdueDays = overdue.reduce(
      (worst, debt) => Math.max(worst, overdueDays(debt, today)),
      0,
    );

    const policy = this.resolvePolicy(row);
    const balance = round(pendingTotal - unallocatedTotal);
    const account: CheckingAccountDto = {
      uuid: row.uuid,
      party: row.party,
      role: row.role,
      enabled: row.enabled,
      balance,
      overdueAmount,
      openDebtCount: debts.length,
      oldestOverdueDays,
      delinquencyException: row.exception,
      policy,
      lastMovementDate: this.lastMovementDate(row.uuid),
    };

    return {
      ...account,
      delinquency: delinquencyLevel(account, today),
      availableAmount: availableAmount(balance, policy.debtLimit.value),
    };
  }

  /** §5.2 — titular → empresa → sistema, y el valor viaja con el peldaño del que salió. */
  private resolvePolicy(row: MockAccountRow): ResolvedPolicy {
    const resolve = <K extends keyof PolicyValues>(
      key: K,
    ): ResolvedPolicyValue<PolicyValues[K]> => {
      if (row.policyOverride[key] !== undefined) {
        return { value: row.policyOverride[key] as PolicyValues[K], source: 'ACCOUNT' };
      }
      if (COMPANY_POLICY[key] !== undefined) {
        return { value: COMPANY_POLICY[key] as PolicyValues[K], source: 'COMPANY' };
      }
      return { value: DEFAULT_POLICY[key], source: 'DEFAULT' as PolicySource };
    };

    return {
      dueDays: resolve('dueDays'),
      debtLimit: resolve('debtLimit'),
      openDebtLimit: resolve('openDebtLimit'),
      allocationMode: resolve('allocationMode'),
      notifyOnDue: resolve('notifyOnDue'),
      dueSoonDays: resolve('dueSoonDays'),
    };
  }

  private lastMovementDate(accountUuid: string): string | null {
    const dates = [
      ...this.debts
        .filter((debt) => debt.accountUuid === accountUuid)
        .map((debt) => debt.dateIssued),
      ...this.credits
        .filter((credit) => credit.accountUuid === accountUuid)
        .map((credit) => credit.dateIssued),
    ];
    return dates.length ? (dates.sort().at(-1) ?? null) : null;
  }

  private loadSeed(seed: AccountSeed): void {
    const party: PartyRef = {
      ...seed.party,
      roles: ACCOUNT_SEEDS.filter((other) => other.party.uuid === seed.party.uuid).map(
        (other) => other.role,
      ),
    };

    const row: MockAccountRow = {
      uuid: seed.uuid,
      party,
      role: seed.role,
      enabled: seed.enabled ?? true,
      policyOverride: seed.policy ?? {},
      exception: seed.exception
        ? {
            level: seed.exception.level,
            dateUntil: addDays(todayIso(), seed.exception.daysUntil),
            reason: seed.exception.reason,
            authorizedBy: seed.exception.authorizedBy,
          }
        : null,
    };
    this.accounts.push(row);

    const dueDays = seed.policy?.dueDays ?? COMPANY_POLICY.dueDays ?? DEFAULT_POLICY.dueDays;
    const today = todayIso();

    const debtUuids = (seed.debts ?? []).map((debtSeed) => {
      const dateIssued = addDays(today, -debtSeed.issuedDaysAgo);
      const dateDueOriginal = addDays(dateIssued, debtSeed.dueDays ?? dueDays);
      const uuid = this.nextId('debt');
      this.debts.push({
        uuid,
        accountUuid: seed.uuid,
        origin: debtSeed.origin,
        publicId: debtSeed.publicId,
        amount: debtSeed.amount,
        pendingAmount: debtSeed.amount,
        dateIssued,
        dateDue: addDays(dateDueOriginal, debtSeed.extendedByDays ?? 0),
        dateDueOriginal,
        dateVoided: null,
        voidReason: null,
        branchName: debtSeed.branchName ?? 'Sucursal Central',
        description: debtSeed.description,
      });
      return uuid;
    });

    const creditUuids = (seed.credits ?? []).map((creditSeed) => {
      const uuid = this.nextId('credit');
      this.credits.push({
        uuid,
        accountUuid: seed.uuid,
        origin: creditSeed.origin,
        publicId: creditSeed.publicId,
        amount: creditSeed.amount,
        unallocatedAmount: creditSeed.amount,
        dateIssued: addDays(today, -creditSeed.issuedDaysAgo),
        dateVoided: null,
        voidReason: null,
        branchName: creditSeed.branchName ?? 'Sucursal Central',
        description: creditSeed.description,
        payments: creditSeed.payments ?? [],
      });
      return uuid;
    });

    (seed.allocations ?? []).forEach((allocationSeed) => {
      const debt = this.debts.find((row2) => row2.uuid === debtUuids[allocationSeed.debt]);
      const credit = this.credits.find((row2) => row2.uuid === creditUuids[allocationSeed.credit]);
      if (!debt || !credit) {
        return;
      }

      debt.pendingAmount = round(debt.pendingAmount - allocationSeed.amount);
      credit.unallocatedAmount = round(credit.unallocatedAmount - allocationSeed.amount);
      this.allocations.push({
        uuid: this.nextId('allocation'),
        accountUuid: seed.uuid,
        debtUuid: debt.uuid,
        debtPublicId: debt.publicId,
        creditUuid: credit.uuid,
        creditPublicId: credit.publicId,
        amount: allocationSeed.amount,
        mode: allocationSeed.mode,
        dateCreated: new Date(
          parseIsoTimestamp(addDays(today, -allocationSeed.daysAgo)),
        ).toISOString(),
        dateReversed: null,
        reverseReason: null,
        userName: allocationSeed.userName ?? 'J. Báez',
      });
    });
  }

  private nextReceiptPublicId(role: PartyRole): string {
    this.receiptSequence += 1;
    const prefix = role === 'CUSTOMER' ? 'REC' : 'PAG';
    return `${prefix}-X-0001-${`${this.receiptSequence}`.padStart(5, '0')}`;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${`${this.sequence}`.padStart(5, '0')}`;
  }

  private currentUserName(): string {
    return this.auth.authUser()?.username ?? 'Usuario actual';
  }
}

/** Redondeo a dos decimales: sin él, restar importes deja saldos de 1e-10 que rompen `= 0`. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseIsoTimestamp(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12).getTime();
}

function defaultCreditDescription(role: PartyRole): string {
  return role === 'CUSTOMER' ? 'Cobro a cuenta corriente' : 'Pago a cuenta corriente';
}
