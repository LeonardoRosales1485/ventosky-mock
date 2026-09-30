import { Versioned } from '../../../core/concurrency/version-conflict.model';

/**
 * Un valor de un eje de variante: `M`, `Rojo`.
 *
 * El `displayOrder` no es cosmético: es lo único que hace que `L` salga después de `M`, que
 * alfabéticamente es al revés. Lo define el usuario arrastrando y el backend lo reasigna por
 * posición, así que la **posición en el array es el orden** y no hace falta mandarlo.
 */
export interface ProductOptionValueDto {
  uuid?: string;
  value: string;
  /** Sufijo del SKU sugerido («RO») y/o hex del chip del color. Opcional. */
  code?: string | null;
  displayOrder?: number;
  /**
   * Cuántas variantes activas usan este valor. De sólo lectura.
   *
   * Es la columna «Variantes en uso» de la pantalla, y está para explicar **antes del clic** por qué
   * un valor no se puede borrar. Enterarse por un 409 después de intentarlo es peor.
   */
  variantsInUse?: number;
}

/** Un eje de variante con sus valores: Talle, Color, Capacidad. */
export interface ProductOptionDto extends Versioned {
  uuid: string;
  name: string;
  displayOrder?: number;
  /** El listado no los trae —muestra sólo `valuesCount`—; el detalle por uuid sí. */
  values?: ProductOptionValueDto[];
  valuesCount?: number;
  variantsInUse?: number;
}

export interface ProductOptionSavePayload {
  uuid?: string;
  name: string;
  displayOrder?: number;
  /**
   * La lista **completa** de valores: lo que no viene se da de baja. `undefined` no toca la grilla,
   * que es como se renombra un eje sin reenviar sus 40 talles.
   */
  values?: ProductOptionValueDto[];
  version?: number;
}
