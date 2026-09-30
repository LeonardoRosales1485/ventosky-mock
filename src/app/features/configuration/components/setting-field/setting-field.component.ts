import { NgComponentOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Field } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  ConfigurationLevel,
  ConfigurationScope,
  SettingDefinitionDto,
  allowsLevel,
  settingType,
} from '../../../../core/configuration/configuration.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { SettingSourceComponent } from '../../../../shared/components/setting-source/setting-source.component';
import { EDITOR_OVERRIDES, SettingEditorInputs } from '../../data-access/setting-editors';
import { SettingLevelsComponent } from '../setting-levels/setting-levels.component';
import { fromBooleanValue, toBooleanValue } from '../../data-access/configuration-form.model';

/**
 * Una clave de la pantalla: su nombre, su control, de qué nivel salió el valor y cómo volver atrás.
 *
 * **El control lo elige el tipo, no la clave.** El catálogo dice que algo es un entero acotado o uno
 * de N valores; de ahí sale el `@switch` de abajo. Por eso una clave nueva de un tipo ya conocido no
 * toca este componente: alcanza con sus dos claves de i18n. Un tipo nuevo, en cambio, obliga a
 * agregar un caso — que es exactamente donde uno quiere que duela.
 *
 * La escapatoria es {@link EDITOR_OVERRIDES}: una clave que merece un editor propio se dibuja con él
 * y no con el control de su tipo. Hoy es una sola.
 *
 * El valor se escribe a mano —`[value]` y el evento— en vez de con `[formField]` porque cada
 * escritura tiene que además marcar la clave como pisada en este nivel: es la diferencia entre «lo
 * decidí acá» y «lo heredé», y es lo que decide si el guardado crea una fila o no.
 */
@Component({
  selector: 'app-setting-field',
  imports: [
    NgComponentOutlet,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TranslatePipe,
    FieldErrorPipe,
    SettingSourceComponent,
    SettingLevelsComponent,
  ],
  templateUrl: './setting-field.component.html',
  styleUrl: './setting-field.component.css',
})
export class SettingFieldComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly definition = input.required<SettingDefinitionDto>();
  readonly field = input.required<Field<string | null>>();

  /** El nivel que se está editando. Decide el tono del chip y si el campo se puede tocar. */
  readonly level = input.required<ConfigurationLevel>();

  /** El nivel del que salió el valor vigente. */
  readonly source = input.required<ConfigurationScope>();

  /** `true` si este nivel tiene fila propia para la clave: es lo que «Restablecer» borra. */
  readonly overridden = input.required<boolean>();

  /** Qué regiría sin la fila de este nivel. Lo dice el hint de «Restablecer». */
  readonly inheritedValue = input.required<string | null>();

  /** El valor crudo de cada nivel, para el inspector. Sólo llega con `?levels=true`. */
  readonly levels = input<Partial<Record<ConfigurationLevel, string | null>> | null>(null);

  /** `false` sin `configuration.edit`: la pantalla queda de lectura. */
  readonly editable = input.required<boolean>();

  readonly changed = output<void>();

  /** No se llama `reset`: `output('reset')` pisaría el evento homónimo del DOM. */
  readonly cleared = output<void>();

  /** El inspector de niveles se abre por fila: es una lectura de apoyo, no una tarea. */
  protected readonly showLevels = signal(false);

  protected readonly type = computed(() => settingType(this.definition()));

  /** El editor propio de la clave, si tiene uno. Si no, manda el tipo. */
  protected readonly override = computed(() => EDITOR_OVERRIDES[this.definition().key] ?? null);

  /** La clave no admite este nivel: se muestra en lectura con el motivo, no se esconde. */
  protected readonly outOfLevel = computed(() => !allowsLevel(this.definition(), this.level()));

  protected readonly disabled = computed(() => !this.editable() || this.outOfLevel());

  /** «Restablecer» sólo donde hay algo que restablecer. */
  protected readonly canReset = computed(() => this.overridden() && !this.disabled());

  protected readonly asBoolean = computed(() => toBooleanValue(this.field()().value()));

  protected readonly possibleValues = computed(() => this.definition().possibleValues ?? []);

  /** El nivel al que hay que ir para editar una clave que este nivel no admite. */
  protected readonly configurableAt = computed(() => {
    const scopes = this.definition().allowedScopes ?? [];
    return scopes.length > 0 ? scopes[scopes.length - 1] : null;
  });

  protected readonly inputs = computed<SettingEditorInputs>(() => ({
    definition: this.definition(),
    value: this.field()().value(),
    disabled: this.disabled(),
    write: (value: string | null) => this.write(value),
  }));

  /** El hint de «Restablecer»: a qué valor vuelve. Sin eso, restablecer es una apuesta. */
  protected readonly resetHint = computed(() =>
    this.translate.instant('configuration.actions.resetHint', {
      value: this.displayValue(this.inheritedValue()),
    }),
  );

  protected write(value: string | null): void {
    const field = this.field()();
    field.value.set(value === '' ? null : value);
    field.markAsTouched();
    this.changed.emit();
  }

  protected onInput(event: Event): void {
    this.write((event.target as HTMLInputElement).value);
  }

  protected onToggle(checked: boolean): void {
    this.write(fromBooleanValue(checked));
  }

  /**
   * La etiqueta de un valor de `enum`, con el valor crudo como respaldo.
   *
   * Los textos son i18n **del front**: así `STRICT_BLOCK` se lee «Bloquear la venta» sin que el
   * backend cargue con textos de interfaz. Una clave nueva que todavía no tenga traducción muestra
   * su valor crudo, que es feo pero cierto — mejor que una clave de i18n en pantalla.
   */
  protected valueLabel(value: string): string {
    this.language.currentLang();

    const key = `configuration.values.${this.definition().key}.${value}`;
    const label = this.translate.instant(key);
    return label === key ? value : label;
  }

  /** El valor tal como se lee: la etiqueta del enum, o el texto crudo, o «sin configurar». */
  protected displayValue(value: string | null): string {
    if (value === null || value === '') {
      return this.translate.instant('configuration.source.empty');
    }
    return this.type() === 'enum' ? this.valueLabel(value) : value;
  }
}
