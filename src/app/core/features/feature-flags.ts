import { environment } from '../../../environments/environment';

/**
 * Interruptores de funcionalidad de la interfaz, definidos en `src/environments/*`.
 *
 * Apagar uno **esconde la puerta de entrada** —la opción del formulario, el botón, la ruta—; no
 * borra datos ni cambia lo que el backend acepta. Por eso lo que ya existe sigue funcionando:
 * un producto que ya se lleva por lote conserva su control de existencias al editarlo.
 */
export interface FeatureFlags {
  /** Control de existencias «Por lote». */
  readonly batchTracking: boolean;
  /** Control de existencias «Por número de serie». */
  readonly serialTracking: boolean;
  /** Alta y edición de modelos de variantes. */
  readonly productModels: boolean;
}

export const FEATURES: FeatureFlags = environment.features;

/**
 * Si el formulario de producto ofrece un modo de control de existencias. `current` es el modo con el
 * que el producto ya está guardado: se sigue mostrando aunque su interruptor esté apagado, para que
 * editar un producto por lote no lo deje sin opción marcada ni lo empuje a cambiarlo.
 */
export function isStockTrackingOffered(
  mode: string,
  current: string | null,
  features: FeatureFlags = FEATURES,
): boolean {
  if (mode === current) {
    return true;
  }
  if (mode === 'BATCH') {
    return features.batchTracking;
  }
  if (mode === 'SERIAL') {
    return features.serialTracking;
  }
  return true;
}

/**
 * El vencimiento sólo vive en lotes o series: sin ninguno de los dos disponibles —ni ya en uso— el
 * bloque no tiene nada que decidir y se esconde.
 */
export function isExpirationOffered(
  current: string | null,
  features: FeatureFlags = FEATURES,
): boolean {
  return (
    features.batchTracking || features.serialTracking || current === 'BATCH' || current === 'SERIAL'
  );
}
