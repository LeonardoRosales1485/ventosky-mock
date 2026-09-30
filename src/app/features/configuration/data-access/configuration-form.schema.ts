import {
  SchemaFn,
  ValidationError,
  maxError,
  maxLengthError,
  minError,
  validate,
} from '@angular/forms/signals';
import { SettingDefinitionDto } from '../../../core/configuration/configuration.model';
import {
  SettingValidationError,
  SettingsFormModel,
  validateSetting,
} from './configuration-form.model';

/**
 * El esquema del formulario **se genera** desde el catálogo: un validador por definición, con el
 * `type` y las `constraints` que publicó el backend. Nada acá nombra una clave, así que una clave
 * nueva valida sola.
 *
 * Está separado de `configuration-form.model.ts` porque ese archivo no importa Angular —es lo que lo
 * hace probable en esta suite— y esto sí: es el puente entre sus errores y los de Signal Forms.
 */
export function settingsSchema(
  definitions: readonly SettingDefinitionDto[],
): SchemaFn<SettingsFormModel> {
  return (path) => {
    for (const definition of definitions) {
      const field = path[definition.key];
      if (!field) {
        continue;
      }
      // El modelo es un `Record`, así que el valor llega sin tipo concreto: acá se sabe que es el
      // texto crudo de la clave, que es lo único que este formulario guarda.
      validate(field, ({ value }) =>
        toValidationError(validateSetting(definition, (value() ?? null) as string | null)),
      );
    }
  };
}

/**
 * Traduce el error propio al de Signal Forms. Los tres con argumento usan los constructores del
 * framework para que `field-error.pipe` redacte el mensaje con el límite adentro —«el mínimo es
 * 0»— en lugar de un «valor inválido» que no dice cuál es el problema.
 */
export function toValidationError(error: SettingValidationError | null): ValidationError | null {
  if (!error) {
    return null;
  }

  switch (error.kind) {
    case 'min':
      return minError(error.min);
    case 'max':
      return maxError(error.max);
    case 'maxLength':
      return maxLengthError(error.maxLength);
    default:
      return { kind: error.kind };
  }
}
