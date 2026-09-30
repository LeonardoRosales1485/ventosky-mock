import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { SelectedCashRegisterStore } from '../cash-session/selected-cash-register.store';

/**
 * Adjunta la caja del contexto (`X-Cash-Register-Uuid`), como el `authInterceptor` hace con la
 * empresa y la sucursal.
 *
 * Va aparte y no dentro de aquél porque no es contexto de sesión sino de operación: cambia cuando
 * el operador cambia de caja, no cuando cambia de empresa.
 *
 * Hace falta **incluso cuando el cuerpo ya declara la caja**: `POST /order/commit` la manda en el
 * payload, pero `OrderCommitContextResolver` resuelve la caja del header como fallback antes de
 * mirar el cuerpo, así que sin el header responde `400 CashRegister requerida` aunque la caja esté
 * ahí. Se manda en todo request y no sólo en los del mostrador: es el mismo criterio que empresa y
 * sucursal, y del lado del backend nadie más que `pos-context` cambia de comportamiento por tenerlo.
 */
export const cashRegisterInterceptor: HttpInterceptorFn = (req, next) => {
  const cashRegisterUuid = inject(SelectedCashRegisterStore).current();

  if (!cashRegisterUuid || req.headers.has('X-Cash-Register-Uuid')) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { 'X-Cash-Register-Uuid': cashRegisterUuid } }));
};
