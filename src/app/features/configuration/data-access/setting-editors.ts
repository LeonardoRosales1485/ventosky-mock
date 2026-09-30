import { Type } from '@angular/core';
import { SettingDefinitionDto } from '../../../core/configuration/configuration.model';
import { ScaleFormatEditorComponent } from '../components/scale-format-editor/scale-format-editor.component';

/**
 * Lo que recibe un editor propio. Son inputs comunes y una función de escritura, no un `output`:
 * `ngComponentOutlet` sabe pasar inputs y no sabe suscribirse a outputs.
 */
export interface SettingEditorInputs {
  /** `ngComponentOutlet` pide un mapa de inputs, así que el contrato lleva su índice. */
  [input: string]: unknown;
  definition: SettingDefinitionDto;
  /** Valor crudo actual, tal como se persiste. */
  value: string | null;
  disabled: boolean;
  /** Escribe el valor crudo. `null` o vacío significan «sin valor». */
  write: (value: string | null) => void;
}

/**
 * La escapatoria del mapa tipo → control: una clave que merece un editor propio se registra acá y
 * se dibuja con él en lugar del control de su tipo.
 *
 * Es el único lugar de la pantalla que nombra una clave concreta, y está pensado para quedarse
 * chico. El backend no se entera: para él `sale.scaleBarcodeFormat` sigue siendo un `string` con
 * `pattern`, y una clave nueva de un tipo conocido no pasa por acá.
 */
export const EDITOR_OVERRIDES: Record<string, Type<unknown>> = {
  'sale.scaleBarcodeFormat': ScaleFormatEditorComponent,
};
