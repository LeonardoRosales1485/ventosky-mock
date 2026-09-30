import { describe, expect, it } from 'vitest';
import {
  PurchaseBatchSplit,
  PurchaseProductDto,
  allocatedQuantity,
  readBatchIssue,
} from './purchase.model';

const AMOX: PurchaseProductDto = {
  uuid: 'amox',
  name: 'Amoxicilina 500',
  stockTracking: 'BATCH',
  expirationControl: 'REQUIRED',
};

const SCREW: PurchaseProductDto = { uuid: 'screw', name: 'Tornillo', stockTracking: 'QUANTITY' };

const batch = (
  batchNumber: string,
  quantity: number | null,
  expirationDate: string | null = '2027-04-30',
): PurchaseBatchSplit => ({ key: batchNumber, batchNumber, expirationDate, quantity });

/**
 * El reparto en partidas de una línea de compra (§7.2): lo que traba el commit, dicho por línea.
 */
describe('readBatchIssue', () => {
  it('does not apply to a product without batches', () => {
    expect(readBatchIssue({ product: SCREW, quantity: 10, batches: [] })).toBeNull();
  });

  it('is unbalanced until the batches sum the line quantity', () => {
    expect(readBatchIssue({ product: AMOX, quantity: 30, batches: [] })).toBe('UNBALANCED');
    expect(
      readBatchIssue({ product: AMOX, quantity: 30, batches: [batch('L-2411', 20)] }),
    ).toBe('UNBALANCED');
    expect(
      readBatchIssue({
        product: AMOX,
        quantity: 30,
        batches: [batch('L-2411', 20), batch('L-2503', 10)],
      }),
    ).toBeNull();
  });

  it('flags a batch without number before anything else', () => {
    expect(
      readBatchIssue({ product: AMOX, quantity: 30, batches: [batch('  ', 30)] }),
    ).toBe('MISSING_NUMBER');
  });

  it('demands the expiration only when the product requires it (RN-03)', () => {
    expect(
      readBatchIssue({ product: AMOX, quantity: 30, batches: [batch('L-2411', 30, null)] }),
    ).toBe('MISSING_EXPIRATION');

    const optional: PurchaseProductDto = { ...AMOX, expirationControl: 'OPTIONAL' };
    expect(
      readBatchIssue({ product: optional, quantity: 30, batches: [batch('L-2411', 30, null)] }),
    ).toBeNull();
  });

  it('tolerates float noise when comparing the allocation', () => {
    expect(
      readBatchIssue({
        product: { ...AMOX, expirationControl: 'NONE' },
        quantity: 0.3,
        batches: [batch('A', 0.1), batch('B', 0.2)],
      }),
    ).toBeNull();
  });
});

describe('allocatedQuantity', () => {
  it('ignores the rows still without quantity', () => {
    expect(allocatedQuantity([batch('A', 5), batch('B', null), batch('C', 2.5)])).toBe(7.5);
  });
});
