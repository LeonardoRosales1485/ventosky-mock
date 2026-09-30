import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorBody,
  resolveApiErrorMessage,
} from './api-error.model';

function apiError(status: number, body: Record<string, unknown>): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body });
}

describe('hasApiErrorCode', () => {
  it('recognises the code the backend sent', () => {
    const error = apiError(401, {
      status: 'UNAUTHORIZED',
      errorCode: 'ACCESS_TOKEN_EXPIRED',
      userMessage: 'El token de acceso ha expirado. Por favor inicie sesión nuevamente',
    });

    expect(hasApiErrorCode(error, API_ERROR_CODES.ACCESS_TOKEN_EXPIRED)).toBe(true);
  });

  /**
   * El status por sí solo no alcanza: un 401 puede ser token vencido —se refresca y se reintenta—
   * o token ausente/inválido, que tiene que llegar al llamador.
   */
  it('rejects another error that answers the same status', () => {
    const error = apiError(401, { status: 'UNAUTHORIZED', errorCode: 'ACCESS_TOKEN_INVALID' });

    expect(hasApiErrorCode(error, API_ERROR_CODES.ACCESS_TOKEN_EXPIRED)).toBe(false);
  });

  it('rejects a body without code, a non-object body and a non-HTTP failure', () => {
    expect(hasApiErrorCode(apiError(401, { userMessage: 'Sin código' }), 'ACCESS_TOKEN_EXPIRED'))
      .toBe(false);
    expect(
      hasApiErrorCode(
        new HttpErrorResponse({ status: 401, error: 'Unauthorized' }),
        'ACCESS_TOKEN_EXPIRED',
      ),
    ).toBe(false);
    expect(hasApiErrorCode(new Error('offline'), 'ACCESS_TOKEN_EXPIRED')).toBe(false);
    expect(hasApiErrorCode(null, 'ACCESS_TOKEN_EXPIRED')).toBe(false);
  });
});

describe('readApiErrorBody', () => {
  it('returns the body only when the failure carries the API shape', () => {
    expect(readApiErrorBody(apiError(400, { errorCode: 'RECORD_NOT_FOUND' }))?.errorCode).toBe(
      'RECORD_NOT_FOUND',
    );
    expect(readApiErrorBody(new HttpErrorResponse({ status: 500, error: null }))).toBeNull();
    expect(readApiErrorBody('boom')).toBeNull();
  });
});

describe('resolveApiErrorMessage', () => {
  it('prefers the user message, then the generic one, then the fallback', () => {
    expect(
      resolveApiErrorMessage(apiError(400, { userMessage: 'No existe el registro' }), 'Falló'),
    ).toBe('No existe el registro');
    expect(resolveApiErrorMessage(apiError(400, { message: 'Genérico' }), 'Falló')).toBe('Genérico');
    expect(resolveApiErrorMessage(apiError(400, {}), 'Falló')).toBe('Falló');
    expect(resolveApiErrorMessage(new Error('offline'), 'Falló')).toBe('Falló');
  });
});
