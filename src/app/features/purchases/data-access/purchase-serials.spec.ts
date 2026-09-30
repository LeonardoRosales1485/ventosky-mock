import { describe, expect, it } from 'vitest';
import {
  PurchaseProductDto,
  isBatchTracked,
  isSerialTracked,
  readSerialIssue,
} from './purchase.model';

const NOTEBOOK: PurchaseProductDto = {
  uuid: 'nb',
  name: 'Notebook Aureo 14"',
  stockTracking: 'SERIAL',
};

/** El electrodoméstico con partida y serie a la vez (P9 del funcional). */
const FRIDGE: PurchaseProductDto = {
  uuid: 'fridge',
  name: 'Heladera',
  stockTracking: 'SERIAL',
  expirationControl: 'OPTIONAL',
};

const AMOX: PurchaseProductDto = {
  uuid: 'amox',
  name: 'Amoxicilina 500',
  stockTracking: 'BATCH',
  expirationControl: 'REQUIRED',
};

const SCREW: PurchaseProductDto = { uuid: 'screw', name: 'Tornillo', stockTracking: 'QUANTITY' };

/**
 * Los números de serie de una línea de compra (§9): la cantidad de la línea **es** la cantidad de
 * series informadas (RN-17), no un número aparte que haya que mantener igual.
 */
describe('readSerialIssue', () => {
  it('does not apply to a product without serials', () => {
    expect(readSerialIssue({ product: SCREW, quantity: 10, serials: [] })).toBeNull();
    expect(readSerialIssue({ product: AMOX, quantity: 10, serials: [] })).toBeNull();
  });

  it('is a count mismatch until there is one serial per unit', () => {
    expect(readSerialIssue({ product: NOTEBOOK, quantity: 3, serials: ['SN-1'] })).toBe(
      'COUNT_MISMATCH',
    );
    expect(readSerialIssue({ product: NOTEBOOK, quantity: 3, serials: ['SN-1', 'SN-2'] })).toBe(
      'COUNT_MISMATCH',
    );
    expect(
      readSerialIssue({ product: NOTEBOOK, quantity: 3, serials: ['SN-1', 'SN-2', 'SN-3'] }),
    ).toBeNull();
  });

  it('is a count mismatch with more serials than units too', () => {
    expect(
      readSerialIssue({ product: NOTEBOOK, quantity: 2, serials: ['SN-1', 'SN-2', 'SN-3'] }),
    ).toBe('COUNT_MISMATCH');
  });

  /**
   * Tiene código propio y no `COUNT_MISMATCH`: el número **está**, lo que no puede es entrar dos
   * veces. Decir «faltan series» mandaría a contar en vez de a mirar el repetido.
   */
  it('reports a duplicate before the count, even when the count would match', () => {
    expect(readSerialIssue({ product: NOTEBOOK, quantity: 2, serials: ['SN-1', 'SN-1'] })).toBe(
      'DUPLICATED',
    );
  });

  /** El operador tipea y el lector escanea: `sn-1` y `SN-1` son la misma notebook. */
  it('detects a duplicate regardless of case and surrounding spaces', () => {
    expect(readSerialIssue({ product: NOTEBOOK, quantity: 2, serials: ['SN-1', ' sn-1 '] })).toBe(
      'DUPLICATED',
    );
  });
});

/**
 * Qué línea entra por partidas declaradas. Tiene que decir lo mismo que
 * `Product.usesNamedBatches()` en el backend: si acá dijera que no, la línea no mandaría
 * `batches[]` y el commit la rechazaría.
 */
describe('isBatchTracked', () => {
  it('is true for a BATCH product', () => {
    expect(isBatchTracked(AMOX)).toBe(true);
  });

  it('is false for a plain serialized product: it uses the single batch', () => {
    expect(isBatchTracked(NOTEBOOK)).toBe(false);
  });

  /** El vencimiento vive en la partida (RN-03), así que un serializado que vence necesita una. */
  it('is true for a serialized product that declares expiration control (P9)', () => {
    expect(isBatchTracked(FRIDGE)).toBe(true);
  });

  it('is false for a plain quantity product', () => {
    expect(isBatchTracked(SCREW)).toBe(false);
  });
});

describe('isSerialTracked', () => {
  it('is true only for SERIAL, with or without expiration', () => {
    expect(isSerialTracked(NOTEBOOK)).toBe(true);
    expect(isSerialTracked(FRIDGE)).toBe(true);
    expect(isSerialTracked(AMOX)).toBe(false);
    expect(isSerialTracked(SCREW)).toBe(false);
  });
});
