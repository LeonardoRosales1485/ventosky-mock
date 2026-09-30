import { describe, expect, it } from 'vitest';
import { FeatureFlags, isExpirationOffered, isStockTrackingOffered } from './feature-flags';

const OFF: FeatureFlags = { batchTracking: false, serialTracking: false, productModels: false };

describe('isStockTrackingOffered', () => {
  it('always offers the modes that have no flag', () => {
    expect(isStockTrackingOffered('NONE', null, OFF)).toBe(true);
    expect(isStockTrackingOffered('QUANTITY', null, OFF)).toBe(true);
  });

  it('hides batch and serial while their flags are off', () => {
    expect(isStockTrackingOffered('BATCH', null, OFF)).toBe(false);
    expect(isStockTrackingOffered('SERIAL', 'QUANTITY', OFF)).toBe(false);
  });

  it('offers each one when its own flag is on', () => {
    expect(isStockTrackingOffered('BATCH', null, { ...OFF, batchTracking: true })).toBe(true);
    expect(isStockTrackingOffered('SERIAL', null, { ...OFF, batchTracking: true })).toBe(false);
    expect(isStockTrackingOffered('SERIAL', null, { ...OFF, serialTracking: true })).toBe(true);
  });

  it('keeps the mode the product is already saved with', () => {
    expect(isStockTrackingOffered('BATCH', 'BATCH', OFF)).toBe(true);
    expect(isStockTrackingOffered('SERIAL', 'BATCH', OFF)).toBe(false);
  });
});

describe('isExpirationOffered', () => {
  it('hides expiration when neither batches nor serials are available or in use', () => {
    expect(isExpirationOffered(null, OFF)).toBe(false);
    expect(isExpirationOffered('QUANTITY', OFF)).toBe(false);
  });

  it('shows it when either is enabled or the product already uses one', () => {
    expect(isExpirationOffered(null, { ...OFF, batchTracking: true })).toBe(true);
    expect(isExpirationOffered(null, { ...OFF, serialTracking: true })).toBe(true);
    expect(isExpirationOffered('SERIAL', OFF)).toBe(true);
  });
});
