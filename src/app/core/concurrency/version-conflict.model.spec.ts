import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { isVersionConflict, readConflictCurrentVersion } from './version-conflict.model';

function conflict(
  errorCode: string,
  developerMessage = '',
  data?: Record<string, unknown>,
  userMessage = 'Registro desactualizado. Otro usuario modificó este registro mientras lo editabas.',
): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 409,
    error: { status: 'CONFLICT', errorCode, developerMessage, userMessage, data },
  });
}

describe('isVersionConflict', () => {
  it('recognises the optimistic-locking conflict by its code', () => {
    expect(isVersionConflict(conflict('VERSION_CONFLICT'))).toBe(true);
  });

  /**
   * El mismo código cubre los dos caminos del backend —el rechazo previo al guardado y la carrera
   * detectada en el flush—, que antes se distinguían por dos prefijos distintos del
   * `developerMessage`.
   */
  it('covers both backend paths under the same code', () => {
    const beforeSaving = conflict(
      'VERSION_CONFLICT',
      'Error en AbstractService.hookSaveValidateVersion: Category uuid=01a01509 version enviada=0, version actual=1',
    );
    const raceAtFlush = conflict(
      'VERSION_CONFLICT',
      'Error en AbstractService.saveOrCreate: conflicto de @Version en Brand uuid=abc',
    );

    expect(isVersionConflict(beforeSaving)).toBe(true);
    expect(isVersionConflict(raceAtFlush)).toBe(true);
  });

  /**
   * El backend usa 409 para varios conflictos de negocio que no se resuelven recargando el
   * registro. Confundirlos con el bloqueo optimista ofrecería «sobrescribir» donde no hay nada que
   * sobrescribir, y taparía el mensaje que explica el problema real.
   */
  it('ignores the business conflicts that also answer 409', () => {
    expect(isVersionConflict(conflict('INSUFFICIENT_STOCK'))).toBe(false);
    expect(isVersionConflict(conflict('PRICE_RULE_LOCKED'))).toBe(false);
    expect(isVersionConflict(conflict('CATEGORY_IN_USE'))).toBe(false);
  });

  it('ignores a body without code and non-HTTP failures', () => {
    const sinCodigo = new HttpErrorResponse({
      status: 409,
      error: { status: 'CONFLICT', userMessage: 'Registro desactualizado.' },
    });

    expect(isVersionConflict(sinCodigo)).toBe(false);
    expect(isVersionConflict(new Error('offline'))).toBe(false);
    expect(isVersionConflict(null)).toBe(false);
  });

  it('ignores a 409 whose body is not the API error shape', () => {
    expect(isVersionConflict(new HttpErrorResponse({ status: 409, error: 'Conflict' }))).toBe(
      false,
    );
  });
});

describe('readConflictCurrentVersion', () => {
  it('reads the version the record has in the database', () => {
    const error = conflict(
      'VERSION_CONFLICT',
      'Error en AbstractService.hookSaveValidateVersion: Category uuid=01a01509 version enviada=0, version actual=7',
      { uuid: '01a01509', sentVersion: 0, currentVersion: 7 },
    );

    expect(readConflictCurrentVersion(error)).toBe(7);
  });

  /**
   * El dato manda sobre el texto: es el campo del contrato, y el `developerMessage` es prosa que se
   * reformula sin aviso. Antes se leía al revés y por eso este caso hubiera devuelto la versión
   * vieja del mensaje.
   */
  it('reads it from the data field and not from the message', () => {
    const error = conflict(
      'VERSION_CONFLICT',
      'Error en AbstractService.hookSaveValidateVersion: Category uuid=01a01509 version enviada=0, version actual=1',
      { currentVersion: 7 },
    );

    expect(readConflictCurrentVersion(error)).toBe(7);
  });

  /**
   * El 409 por carrera real relee la versión de base después del choque, pero puede no conseguirla
   * —el registro fue borrado, o la lectura falló—. Ahí la clave no viaja y hay que releer el
   * registro.
   */
  it('returns null when the conflict does not carry it', () => {
    const sinData = conflict(
      'VERSION_CONFLICT',
      'Error en AbstractService.saveOrCreate: conflicto de @Version en Brand uuid=abc',
    );
    const sinLaClave = conflict('VERSION_CONFLICT', '', { uuid: 'abc', sentVersion: 3 });

    expect(readConflictCurrentVersion(sinData)).toBeNull();
    expect(readConflictCurrentVersion(sinLaClave)).toBeNull();
  });
});
