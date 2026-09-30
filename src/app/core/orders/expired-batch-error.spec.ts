import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { readExpiredBatchError } from './order-commit.model';

const expiredError = (data: Record<string, unknown>, status = 400, errorCode = 'BATCH_EXPIRED') =>
  new HttpErrorResponse({ status, error: { errorCode, data } });

/** El 400 `BATCH_EXPIRED` (RN-04): lo único con saldo está vencido y la sucursal no lo despacha. */
describe('readExpiredBatchError', () => {
  it('reads the policy, the confirmation and the expired batches', () => {
    const error = readExpiredBatchError(
      expiredError({
        productUuid: 'amox',
        productName: 'Amoxicilina',
        policy: 'WARN',
        confirmable: true,
        batches: [
          { uuid: 'b1', batchNumber: 'L-OLD', expirationDate: '2026-08-12', quantity: 30 },
          { nope: true },
        ],
      }),
    );

    expect(error).toEqual({
      productUuid: 'amox',
      productName: 'Amoxicilina',
      policy: 'WARN',
      confirmable: true,
      batches: [{ uuid: 'b1', batchNumber: 'L-OLD', expirationDate: '2026-08-12', quantity: 30 }],
    });
  });

  it('falls back to BLOCK and not confirmable when the data is incomplete', () => {
    const error = readExpiredBatchError(expiredError({ productName: 'Crema' }));

    expect(error?.policy).toBe('BLOCK');
    expect(error?.confirmable).toBe(false);
    expect(error?.batches).toEqual([]);
  });

  it('ignores any other error', () => {
    expect(readExpiredBatchError(expiredError({}, 409))).toBeNull();
    expect(readExpiredBatchError(expiredError({}, 400, 'INSUFFICIENT_STOCK'))).toBeNull();
    expect(readExpiredBatchError(new Error('boom'))).toBeNull();
  });
});
