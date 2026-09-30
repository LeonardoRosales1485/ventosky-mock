import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  CONFIGURATION_SCOPES,
  ConfigurationLevel,
  ConfigurationScope,
  SettingDefinitionDto,
  allowsLevel,
} from '../../../../core/configuration/configuration.model';

/** Una fila de la escalera: el peldaño, lo que tiene y qué papel juega. */
export interface SettingLevelRow {
  scope: ConfigurationScope;
  /** El valor crudo de ese peldaño, o `null` si no tiene fila. */
  value: string | null;
  /** El peldaño que gana: el más específico que tiene valor. */
  rules: boolean;
  /** La clave no admite ese nivel. */
  notAllowed: boolean;
}

/** De más específico a más general. Es el orden en que se resuelve y en que se muestra. */
const LADDER: readonly ConfigurationScope[] = ['USER', 'BRANCH', 'COMPANY', 'GLOBAL', 'DEFAULT'];

/**
 * La escalera completa de una clave, con el peldaño que rige resaltado.
 *
 * Contesta la pregunta que el chip de origen solo no puede: **por qué este valor y no otro**. El
 * chip dice «Empresa»; esto muestra que la sucursal no tiene nada, que la empresa puso `AVERAGE` y
 * que el valor de la aplicación —el que regiría si nadie hubiera puesto nada— es `FIFO`.
 *
 * Distingue en palabras «Por defecto» de «Global», que es la confusión que el modelo se juega:
 * el primero vive en el código del backend y siempre existe; el segundo es una fila de la instancia
 * que sólo escribe un SysAdmin, y que las claves de negocio ni siquiera admiten.
 *
 * Es una lectura de apoyo y no una tarea, así que se expande dentro de la fila y no en un diálogo.
 */
@Component({
  selector: 'app-setting-levels',
  imports: [TranslatePipe],
  template: `
    <span class="levels__title">{{ 'configuration.levels.title' | translate }}</span>

    @for (row of rows(); track row.scope) {
      <div class="levels__row" [class.levels__row--rules]="row.rules">
        <span class="levels__scope">{{ 'configuration.scope.' + row.scope | translate }}</span>
        <span class="levels__value">{{ row.value ?? '—' }}</span>
        <span class="levels__note">
          @if (row.rules) {
            {{ 'configuration.levels.rules' | translate }}
          } @else if (row.notAllowed) {
            {{ 'configuration.levels.notAllowed' | translate }}
          } @else {
            {{ 'configuration.levels.notes.' + row.scope | translate }}
          }
        </span>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem 0 0.25rem;
    }

    .levels__title {
      font-size: 0.6875rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
    }

    .levels__row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.375rem 0.75rem;
      border-radius: 0.5rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .levels__row--rules {
      background: var(--app-info-container);
      color: var(--app-on-info-container);
      font-weight: 500;
    }

    .levels__scope {
      flex: 0 0 6rem;
      font-size: 0.75rem;
    }

    .levels__value {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
      font-family: 'Roboto Mono', ui-monospace, monospace;
      font-size: 0.8125rem;
    }

    .levels__note {
      flex: 0 0 auto;
      font-size: 0.6875rem;
    }
  `,
})
export class SettingLevelsComponent {
  readonly definition = input.required<SettingDefinitionDto>();

  /** El valor crudo de cada nivel, tal como llega en `?levels=true`. */
  readonly levels = input.required<Partial<Record<ConfigurationLevel, string | null>> | null>();

  readonly rows = computed<SettingLevelRow[]>(() => {
    const definition = this.definition();
    const levels = this.levels() ?? {};
    let ruled = false;

    return LADDER.map((scope) => {
      const isDefault = scope === 'DEFAULT';
      const notAllowed =
        !isDefault && !allowsLevel(definition, scope as ConfigurationLevel);
      const value = isDefault
        ? (definition.defaultValue ?? null)
        : notAllowed
          ? null
          : (levels[scope as ConfigurationLevel] ?? null);

      // El primero de arriba hacia abajo con valor es el que gana; el default cierra la cadena
      // aunque su valor sea nulo, porque es el peldaño que siempre existe.
      const rules = !ruled && (value !== null || isDefault);
      ruled = ruled || rules;

      return { scope, value, rules, notAllowed };
    });
  });

  protected readonly scopes = CONFIGURATION_SCOPES;
}
