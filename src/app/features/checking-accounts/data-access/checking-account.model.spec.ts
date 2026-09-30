import { describe, expect, it } from 'vitest';
import {
  CheckingAccountDebtDto,
  DelinquencyLevel,
  addDays,
  availableAmount,
  creditState,
  daysBetween,
  debtState,
  delinquencyLevel,
  isExtended,
  limitUsageRatio,
  overdueDays,
  parseIsoDate,
  toIsoDate,
} from './checking-account.model';

const TODAY = '2026-08-24';

function debt(overrides: Partial<CheckingAccountDebtDto> = {}): CheckingAccountDebtDto {
  return {
    uuid: 'debt-1',
    accountUuid: 'cca-1',
    origin: 'ORDER',
    publicId: 'FAC-A-0001-00001',
    amount: 100_000,
    pendingAmount: 100_000,
    dateIssued: '2026-07-25',
    dateDue: '2026-08-24',
    dateDueOriginal: '2026-08-24',
    dateVoided: null,
    voidReason: null,
    branchName: 'Sucursal Central',
    description: 'Venta mostrador',
    ...overrides,
  };
}

function policy(debtLimit: number | null) {
  return {
    dueDays: { value: 30, source: 'COMPANY' as const },
    debtLimit: { value: debtLimit, source: 'COMPANY' as const },
    openDebtLimit: { value: null, source: 'DEFAULT' as const },
    allocationMode: { value: 'AUTOMATIC' as const, source: 'COMPANY' as const },
    notifyOnDue: { value: true, source: 'COMPANY' as const },
    dueSoonDays: { value: 3, source: 'COMPANY' as const },
  };
}

describe('debtState', () => {
  it('reports PENDIENTE while nothing was paid and the due date has not passed', () => {
    expect(debtState(debt({ dateDue: '2026-09-10' }), TODAY)).toBe('PENDIENTE');
  });

  it('reports PARCIAL when part of it was allocated', () => {
    expect(debtState(debt({ dateDue: '2026-09-10', pendingAmount: 40_000 }), TODAY)).toBe(
      'PARCIAL',
    );
  });

  /** §7.1 — la deuda vence sola: no hay proceso que la marque, lo hace la fecha de hoy. */
  it('reports VENCIDA the day after the due date, with no job running', () => {
    expect(debtState(debt({ dateDue: '2026-08-24' }), TODAY)).toBe('PENDIENTE');
    expect(debtState(debt({ dateDue: '2026-08-23' }), TODAY)).toBe('VENCIDA');
  });

  /** El orden de evaluación es parte de la regla, y éstos son los dos casos que lo prueban. */
  it('reports PAGADA and ANULADA ahead of VENCIDA, even past the due date', () => {
    expect(debtState(debt({ dateDue: '2026-07-01', pendingAmount: 0 }), TODAY)).toBe('PAGADA');
    expect(
      debtState(debt({ dateDue: '2026-07-01', dateVoided: '2026-07-05T10:00:00Z' }), TODAY),
    ).toBe('ANULADA');
  });
});

describe('overdueDays', () => {
  it('counts whole days past the due date and never goes negative', () => {
    expect(overdueDays(debt({ dateDue: '2026-08-14' }), TODAY)).toBe(10);
    expect(overdueDays(debt({ dateDue: '2026-09-14' }), TODAY)).toBe(0);
  });

  it('is zero for a paid or voided debt, whatever its due date', () => {
    expect(overdueDays(debt({ dateDue: '2026-01-01', pendingAmount: 0 }), TODAY)).toBe(0);
    expect(
      overdueDays(debt({ dateDue: '2026-01-01', dateVoided: '2026-02-01T10:00:00Z' }), TODAY),
    ).toBe(0);
  });
});

describe('isExtended', () => {
  it('only reports a debt whose current due date moved away from the original', () => {
    expect(isExtended(debt())).toBe(false);
    expect(isExtended(debt({ dateDue: '2026-09-08', dateDueOriginal: '2026-08-24' }))).toBe(true);
  });
});

describe('creditState', () => {
  const credit = (amount: number, unallocated: number, voided: string | null = null) => ({
    uuid: 'credit-1',
    accountUuid: 'cca-1',
    origin: 'RECEIPT' as const,
    publicId: 'REC-X-0001-00001',
    amount,
    unallocatedAmount: unallocated,
    dateIssued: '2026-08-20',
    dateVoided: voided,
    voidReason: null,
    branchName: 'Sucursal Central',
    description: 'Cobro',
    payments: [],
  });

  it('derives the state from what is left unallocated', () => {
    expect(creditState(credit(50_000, 50_000))).toBe('SIN_IMPUTAR');
    expect(creditState(credit(50_000, 20_000))).toBe('PARCIAL');
    expect(creditState(credit(50_000, 0))).toBe('IMPUTADO');
    expect(creditState(credit(50_000, 50_000, '2026-08-21T09:00:00Z'))).toBe('ANULADO');
  });
});

describe('delinquencyLevel', () => {
  const account = (
    overdueAmount: number,
    oldestOverdueDays: number,
    debtLimit: number | null = 500_000,
  ) => ({
    overdueAmount,
    oldestOverdueDays,
    delinquencyException: null,
    policy: policy(debtLimit),
  });

  it('is AL_DIA without overdue debt', () => {
    expect(delinquencyLevel(account(0, 0), TODAY)).toBe('AL_DIA');
  });

  it('climbs the ladder by age', () => {
    const byAge: [number, DelinquencyLevel][] = [
      [1, 'EN_MORA'],
      [15, 'EN_MORA'],
      [16, 'MOROSO'],
      [60, 'MOROSO'],
      [61, 'MOROSO_GRAVE'],
    ];

    for (const [days, level] of byAge) {
      expect(delinquencyLevel(account(1_000, days), TODAY)).toBe(level);
    }
  });

  /** §9.1 — antigüedad y exposición se evalúan las dos y gana la peor de las dos lecturas. */
  it('takes the worse of age and exposure', () => {
    // 5 días vencidos —EN_MORA por antigüedad— pero 60% del límite vencido: MOROSO por exposición.
    expect(delinquencyLevel(account(300_000, 5), TODAY)).toBe('MOROSO');
    // Más que el límite entero vencido, con la misma antigüedad.
    expect(delinquencyLevel(account(600_000, 5), TODAY)).toBe('MOROSO_GRAVE');
  });

  it('ignores exposure when the account has no limit', () => {
    expect(delinquencyLevel(account(9_000_000, 5, null), TODAY)).toBe('EN_MORA');
  });

  it('lets a live exception override the calculated level, and a lapsed one expire on its own', () => {
    const delinquent = { ...account(600_000, 70), delinquencyException: null };

    expect(
      delinquencyLevel(
        {
          ...delinquent,
          delinquencyException: {
            level: 'EN_MORA',
            dateUntil: '2026-09-30',
            reason: 'Discusión de facturación',
            authorizedBy: 'J. Báez',
          },
        },
        TODAY,
      ),
    ).toBe('EN_MORA');

    expect(
      delinquencyLevel(
        {
          ...delinquent,
          delinquencyException: {
            level: 'EN_MORA',
            dateUntil: '2026-08-23',
            reason: 'Discusión de facturación',
            authorizedBy: 'J. Báez',
          },
        },
        TODAY,
      ),
    ).toBe('MOROSO_GRAVE');
  });
});

describe('availableAmount', () => {
  it('is the limit minus the balance, and null when there is no limit', () => {
    expect(availableAmount(80_000, 100_000)).toBe(20_000);
    expect(availableAmount(80_000, null)).toBeNull();
  });

  /** §16 — un saldo a favor no consume límite: lo agranda. */
  it('adds a credit balance on top of the limit', () => {
    expect(availableAmount(-5_000, 100_000)).toBe(105_000);
  });
});

describe('limitUsageRatio', () => {
  it('clamps to [0, 100] and gives up without a limit', () => {
    expect(limitUsageRatio(1_245_600, 1_500_000)).toBe(83);
    expect(limitUsageRatio(-5_000, 100_000)).toBe(0);
    expect(limitUsageRatio(300_000, 100_000)).toBe(100);
    expect(limitUsageRatio(300_000, null)).toBeNull();
  });
});

describe('date helpers', () => {
  /**
   * `new Date('2026-08-24')` se interpreta como UTC y en Argentina cae el día anterior. El parser
   * propio existe para eso, y este test es el que evita que alguien lo "simplifique" de vuelta.
   */
  it('parses an ISO date at local midnight, not UTC', () => {
    const parsed = parseIsoDate('2026-08-24');

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(24);
    expect(toIsoDate(parsed)).toBe('2026-08-24');
  });

  it('counts days in both directions and adds them across month ends', () => {
    expect(daysBetween('2026-08-24', '2026-09-03')).toBe(10);
    expect(daysBetween('2026-09-03', '2026-08-24')).toBe(-10);
    expect(addDays('2026-08-24', 10)).toBe('2026-09-03');
    expect(addDays('2026-09-03', -10)).toBe('2026-08-24');
  });
});
