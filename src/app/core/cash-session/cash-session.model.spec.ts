import { describe, expect, it } from 'vitest';
import {
  CashRegisterDto,
  CashSessionDto,
  branchCashRegisters,
  hasOpenSession,
  openedByName,
  withOpenSession,
} from './cash-session.model';

const OPEN_SESSION: CashSessionDto = {
  uuid: 'sesion-1',
  sessionState: 'OPEN',
  openedAt: '2026-08-18T09:00:00',
  openingAmount: 15000,
  openedBy: { uuid: 'u-1', name: 'Ana' },
};

const CLOSED_SESSION: CashSessionDto = {
  ...OPEN_SESSION,
  uuid: 'sesion-0',
  sessionState: 'CLOSED',
};

const CAJA_UNO: CashRegisterDto = { uuid: 'caja-1', name: 'Caja 1', active: true };
const CAJA_DOS: CashRegisterDto = { uuid: 'caja-2', name: 'Caja 2', active: true };

describe('hasOpenSession', () => {
  it('only accepts a session the backend reports as OPEN', () => {
    expect(hasOpenSession({ ...CAJA_UNO, openSession: OPEN_SESSION })).toBe(true);
    expect(hasOpenSession({ ...CAJA_UNO, openSession: CLOSED_SESSION })).toBe(false);
  });

  /** Sin caja resuelta y con la caja sin sesión el resultado es el mismo: no se puede operar. */
  it('treats a missing register and a register without a session alike', () => {
    expect(hasOpenSession(null)).toBe(false);
    expect(hasOpenSession(CAJA_UNO)).toBe(false);
    expect(hasOpenSession({ ...CAJA_UNO, openSession: null })).toBe(false);
  });
});

describe('openedByName', () => {
  it('reports who opened the session', () => {
    expect(openedByName({ ...CAJA_UNO, openSession: OPEN_SESSION })).toBe('Ana');
  });

  it('returns null when there is nobody to name', () => {
    expect(openedByName(null)).toBeNull();
    expect(openedByName(CAJA_UNO)).toBeNull();
    expect(openedByName({ ...CAJA_UNO, openSession: { uuid: 'sesion-2' } })).toBeNull();
  });
});

describe('withOpenSession', () => {
  it('attaches the session to the register that was opened', () => {
    const result = withOpenSession([CAJA_UNO, CAJA_DOS], 'caja-2', OPEN_SESSION);

    expect(hasOpenSession(result[1])).toBe(true);
    expect(result[1].openSession).toEqual(OPEN_SESSION);
  });

  /** Reflejar una apertura no puede alterar el resto del catálogo ni la lista que recibió. */
  it('leaves the other registers and the original array untouched', () => {
    const registers = [CAJA_UNO, CAJA_DOS];
    const result = withOpenSession(registers, 'caja-2', OPEN_SESSION);

    expect(result[0]).toBe(CAJA_UNO);
    expect(registers[1].openSession).toBeUndefined();
    expect(result).not.toBe(registers);
  });

  it('changes nothing when no register matches', () => {
    const result = withOpenSession([CAJA_UNO, CAJA_DOS], 'caja-9', OPEN_SESSION);

    expect(result.some(hasOpenSession)).toBe(false);
  });
});

describe('branchCashRegisters', () => {
  const CENTRO: CashRegisterDto = { ...CAJA_UNO, branch: { uuid: 'b-centro', name: 'Centro' } };
  const NORTE: CashRegisterDto = { ...CAJA_DOS, branch: { uuid: 'b-norte', name: 'Norte' } };

  it('keeps only the registers of the active branch', () => {
    expect(branchCashRegisters([CENTRO, NORTE], 'b-centro')).toEqual([CENTRO]);
  });

  /** Sin sucursal resuelta no hay contra qué filtrar, y esconderlas todas sería peor. */
  it('keeps everything when there is no active branch', () => {
    expect(branchCashRegisters([CENTRO, NORTE], null)).toEqual([CENTRO, NORTE]);
  });

  /** Una caja sin sucursal es una anomalía de datos; ocultarla podría dejar la pantalla sin caja. */
  it('keeps a register that declares no branch', () => {
    expect(branchCashRegisters([CAJA_UNO, NORTE], 'b-centro')).toEqual([CAJA_UNO]);
  });
});
