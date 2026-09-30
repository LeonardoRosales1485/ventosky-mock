import { Component, computed, effect, input, signal } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { SettingDefinitionDto } from '../../../../core/configuration/configuration.model';
import {
  EMPTY_SCALE_FORMAT,
  SCALE_VALUE_TYPES,
  ScaleFormatParts,
  formatScaleFormat,
  isCompleteScaleFormat,
  padScaleSample,
  parseScaleFormat,
  scaleCodeLength,
  scaleValueLength,
} from '../../../../core/product/scale-format.model';

/** Un código de ejemplo para mostrar el desarme: el del documento funcional. */
const SAMPLE_CODE = '00123';
const SAMPLE_VALUE = '01250';
const SAMPLE_CHECK_DIGIT = '7';

/**
 * El editor propio de `sale.scaleBarcodeFormat`: cuatro campos que arman el texto
 * `prefijo:largoCódigo:largoValor:tipo`.
 *
 * Existe sólo de este lado. Para el backend la clave sigue siendo un `string` con `pattern`, y el
 * mapa tipo → control lo dibujaría como un campo de texto — que es exactamente el problema:
 * `2:5:5:WEIGHT` no se valida a ojo. Con las partes separadas y el desarme de un código real abajo,
 * se ve de una qué va a leer la balanza.
 */
@Component({
  selector: 'app-scale-format-editor',
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule, TranslatePipe],
  templateUrl: './scale-format-editor.component.html',
  styleUrl: './scale-format-editor.component.css',
})
export class ScaleFormatEditorComponent {
  readonly definition = input.required<SettingDefinitionDto>();
  readonly value = input.required<string | null>();
  readonly disabled = input.required<boolean>();
  readonly write = input.required<(value: string | null) => void>();

  protected readonly valueTypes = SCALE_VALUE_TYPES;

  /**
   * Las cuatro partes que se están editando, que **no** se derivan del valor guardado.
   *
   * Media configuración no se persiste —un formato con el prefijo puesto y los largos vacíos no
   * desarma ninguna etiqueta—, así que mientras se completa, el valor de arriba es `null`. Si las
   * partes salieran de ahí, cada tecla borraría la anterior y el campo sería imposible de llenar.
   */
  protected readonly parts = signal<ScaleFormatParts>(EMPTY_SCALE_FORMAT);

  /**
   * Lo último que este editor escribió. Es lo que distingue un valor que llega **de afuera** —otro
   * nivel, un «Restablecer»— de la vuelta de la propia escritura: el primero rearma las partes, el
   * segundo no las toca.
   */
  private lastWritten: string | null | undefined;

  constructor() {
    effect(() => {
      const incoming = this.value();
      if (incoming !== this.lastWritten) {
        this.parts.set(parseScaleFormat(incoming));
      }
    });
  }

  /** `true` cuando las cuatro partes están y el desarme de abajo dice algo. */
  protected readonly isComplete = computed(() => isCompleteScaleFormat(this.parts()));

  protected readonly sampleCode = computed(() =>
    padScaleSample(SAMPLE_CODE, scaleCodeLength(this.parts())),
  );
  protected readonly sampleValue = computed(() =>
    padScaleSample(SAMPLE_VALUE, scaleValueLength(this.parts())),
  );
  protected readonly sampleCheckDigit = SAMPLE_CHECK_DIGIT;

  /** Lo que se guarda, o `null` si el formato está a medias: media configuración no se persiste. */
  protected readonly formatted = computed(() =>
    this.isComplete() ? formatScaleFormat(this.parts()) : null,
  );

  protected update(patch: Partial<ScaleFormatParts>): void {
    const parts = { ...this.parts(), ...patch };
    this.parts.set(parts);

    const formatted = isCompleteScaleFormat(parts) ? formatScaleFormat(parts) : null;
    this.lastWritten = formatted;
    this.write()(formatted);
  }

  protected onInput(event: Event, field: 'prefix' | 'codeLength' | 'valueLength'): void {
    this.update({ [field]: (event.target as HTMLInputElement).value.trim() });
  }
}
