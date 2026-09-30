import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { LocalStorageService } from '../local-storage/local-storage.service';
import { TabContextStore } from '../tab-context/tab-context.store';
import { ALL_BRANCHES } from './branch-scope';

/**
 * Adjunta la sesión y el contexto de operación a cada request.
 *
 * La sesión sale de `LocalStorageService` porque es una sola para todo el navegador; la empresa y la
 * sucursal salen de `TabContextStore` porque son de **este tab**, que puede estar operando en una
 * sucursal distinta a la del tab de al lado.
 *
 * Ninguno de los dos es `AuthService`, y así tiene que seguir: meterlo en el grafo de dependencias
 * de un interceptor es lo que termina en un NG0200 al arrancar (ver `TokenRefreshService`).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const storage = inject(LocalStorageService);
  const tabContext = inject(TabContextStore);

  const token = storage.getToken();
  const companyUuid = tabContext.getCompanyUuid();
  const branchUuid = tabContext.getBranchUuid();

  const headers: Record<string, string> = {};

  if (token && !req.headers.has('Authorization')) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (companyUuid && !req.headers.has('X-Company-Uuid')) {
    headers['X-Company-Uuid'] = companyUuid;
  }

  // `ALL_BRANCHES` pide justamente que el header no viaje: omitirlo es lo que el backend lee como
  // «todas las sucursales», así que acá se sale antes de ponerlo.
  if (branchUuid && !req.headers.has('X-Branch-Uuid') && !req.context.get(ALL_BRANCHES)) {
    headers['X-Branch-Uuid'] = branchUuid;
  }

  if (Object.keys(headers).length === 0) {
    return next(req);
  }

  return next(req.clone({ setHeaders: headers }));
};
