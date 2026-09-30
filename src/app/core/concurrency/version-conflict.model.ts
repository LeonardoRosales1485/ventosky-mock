import { API_ERROR_CODES, hasApiErrorCode, readApiErrorData } from '../http/api-error.model';

/**
 * Contador que el Core incrementa en cada guardado y devuelve en todo DTO —`GET /uuid`, cada fila
 * del `POST /paginate`, y las respuestas de `save` y `delete`—. Editar significa reenviarlo: si la
 * versión que manda el front no es la que está en base, el registro cambió desde que se leyó y el
 * backend responde 409 en vez de pisar el trabajo del otro usuario.
 *
 * Es opcional porque no todos los endpoints lo traen: los custom que arman su propio DTO
 * (`GET /category/getAllTree`, `/parents`, `/children`) devuelven nodos sin campos del Core.
 */
export interface Versioned {
  version?: number;
}

/**
 * `true` sólo para el 409 de bloqueo optimista, no para los 409 de negocio.
 *
 * Mirar el `errorCode` y no el status es lo que hace la distinción posible: el backend usa 409
 * también para conflictos que no se resuelven recargando —stock insuficiente, categoría o regla en
 * uso, lote ya finalizado, caja con sesión abierta—, y esos tienen que seguir cayendo en el manejo
 * de error de cada pantalla.
 *
 * `VERSION_CONFLICT` cubre los dos caminos del backend: el rechazo de `hookSaveValidateVersion`
 * (la versión enviada no coincide con la de base) y el `OptimisticLockingFailureException` que
 * salta cuando la carrera ocurre entre el read y el flush.
 */
export function isVersionConflict(error: unknown): boolean {
  return hasApiErrorCode(error, API_ERROR_CODES.VERSION_CONFLICT);
}

/**
 * Versión que tenía el registro en base cuando el backend rechazó el guardado, tal como la informa
 * el 409 en `data.currentVersion`. Es la que hay que reenviar para sobrescribir.
 *
 * La traen los dos caminos del backend: el rechazo de `hookSaveValidateVersion` y el conflicto por
 * carrera real, que la relee de base después del choque. Antes salía de una expresión regular sobre
 * el `developerMessage` —y el de carrera no la traía en ninguna forma, así que sobrescribir costaba
 * un request extra—.
 *
 * `null` cuando el backend no la pudo informar: el registro fue borrado, o la relectura falló. Ahí
 * la clave no viaja, y el llamador relee el registro.
 */
export function readConflictCurrentVersion(error: unknown): number | null {
  const currentVersion = readApiErrorData(error)?.['currentVersion'];

  return typeof currentVersion === 'number' ? currentVersion : null;
}
