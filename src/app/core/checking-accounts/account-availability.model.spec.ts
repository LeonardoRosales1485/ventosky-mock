import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { readAccountDebtLimit } from './account-availability.model';

/** Un 400 del commit con el detalle que adjunta `CheckingAccountDebtLimitExceededException`. */
const rejection = (detail: Record<string, unknown>): HttpErrorResponse =>
  new HttpErrorResponse({
    status: 400,
    error: {
      errorCode: 'ACCOUNT_DEBT_LIMIT_EXCEEDED',
      userMessage: 'La operación deja al cliente por encima de su límite.',
      data: { accountDebtLimit: detail },
    },
  });

describe('readAccountDebtLimit', () => {
  /**
   * El detalle viaja con el disponible y no sólo con el rechazo, y eso es el punto: un «no se puede»
   * a secas manda al cajero a llamar por teléfono.
   */
  it('devuelve el detalle de un rechazo forzable', () => {
    const detail = readAccountDebtLimit(
      rejection({ balance: 90000, debtLimit: 100000, requested: 30000, available: 10000, excess: 20000, forcible: true }),
    );

    expect(detail).toEqual({
      balance: 90000,
      debtLimit: 100000,
      requested: 30000,
      available: 10000,
      excess: 20000,
      forcible: true,
    });
  });

  /**
   * **La marca de forzable la pone el backend**, y sin ella no se ofrece nada.
   *
   * Es lo que evita que la pantalla se sepa de memoria cuál de los cuatro rechazos del portón admite
   * excepción: ese conocimiento duplicado es exactamente el que se desactualiza el día que cambie.
   */
  it('sin la marca de forzable no ofrece nada, aunque venga el detalle', () => {
    expect(
      readAccountDebtLimit(rejection({ balance: 90000, debtLimit: 100000, available: 10000 })),
    ).toBeNull();
    expect(readAccountDebtLimit(rejection({ available: 10000, forcible: false }))).toBeNull();
  });

  /** Los otros rechazos del portón no traen este detalle, y por eso no abren el diálogo. */
  it('un rechazo de otra cosa no es un exceso de límite', () => {
    const disabled = new HttpErrorResponse({
      status: 400,
      error: { errorCode: 'ACCOUNT_DISABLED', userMessage: 'La cuenta está deshabilitada.' },
    });

    expect(readAccountDebtLimit(disabled)).toBeNull();
  });

  /** Un corte de red no es una decisión del negocio: no hay nada que autorizar. */
  it('lo que no es una respuesta del backend no se interpreta', () => {
    expect(readAccountDebtLimit(new Error('offline'))).toBeNull();
    expect(readAccountDebtLimit(null)).toBeNull();
  });
});
