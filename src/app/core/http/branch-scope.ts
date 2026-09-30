import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * Cuando es `true`, el `authInterceptor` **no** adjunta `X-Branch-Uuid`.
 *
 * Omitir la sucursal no es «no informarla»: para el backend significa *todas las sucursales de la
 * empresa*, y es la única lectura que cruza el aislamiento por sucursal (`BranchScopeResolver`).
 * Sólo la aceptan `GET /stock/distribution/{uuid}` y `POST /warehouse/paginate`, y exigen el
 * permiso `stock.view_all_branches`.
 *
 * Va por `HttpContext` y no por un header vacío porque lo que hace falta es **borrar** el header que
 * el interceptor pondría: un `X-Branch-Uuid: ''` viajaría igual y el backend lo leería como una
 * sucursal inexistente.
 */
export const ALL_BRANCHES = new HttpContextToken<boolean>(() => false);

/** `HttpContext` que saca el request del alcance de la sucursal activa. */
export function allBranchesScope(context: HttpContext = new HttpContext()): HttpContext {
  return context.set(ALL_BRANCHES, true);
}
