import { Component, computed, input, signal } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { AttributeValueModel } from '../../data-access/directory-forms';

/** Hasta cuántos campos extra se muestran abiertos de entrada. Con más, el bloque tapa el resto de la ficha. */
const OPEN_UP_TO = 3;

/**
 * Los campos extra que la empresa definió para sus empleados —«talle de uniforme», «obra social»—.
 *
 * Todos viajan como texto y el backend los valida contra su tipo; el formulario anticipa la forma (un entero,
 * un número, una fecha) para que el rechazo llegue antes de guardar. Uno vacío no se manda: no completarlo es no
 * tenerlo.
 *
 * Son de la empresa y pueden ser muchos, así que el bloque se pliega y dice cuántos están completos. Se abre solo
 * cuando alguno tiene un error a la vista: un campo plegado no puede frenar el guardado sin decir por qué.
 */
@Component({
  selector: 'app-directory-attribute-fields',
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    FieldErrorPipe,
  ],
  template: `
    <div class="attributes__header">
      <h3 class="attributes__title" [id]="ids.title">
        {{ 'directory.form.attributes' | translate }}
      </h3>
      <button
        mat-button
        type="button"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="ids.panel"
        [attr.aria-describedby]="ids.title"
        (click)="expanded.set(!open())"
      >
        {{ 'directory.form.attributesCount' | translate: { filled: filled(), total: total() } }}
        <mat-icon iconPositionEnd aria-hidden="true">{{
          open() ? 'expand_less' : 'expand_more'
        }}</mat-icon>
      </button>
    </div>

    @if (open()) {
      <div
        class="attributes__grid"
        role="group"
        [id]="ids.panel"
        [attr.aria-labelledby]="ids.title"
      >
        @for (attribute of attributes(); track $index) {
          @let current = attribute().value();
          <mat-form-field appearance="outline">
            <mat-label>{{ current.name }}</mat-label>
            @switch (current.type) {
              @case ('boolean') {
                <mat-select [formField]="attribute.value" [attr.aria-label]="current.name">
                  <mat-option [value]="''">{{
                    'directory.form.attributeEmpty' | translate
                  }}</mat-option>
                  <mat-option value="true">{{
                    'directory.form.attributeYes' | translate
                  }}</mat-option>
                  <mat-option value="false">{{
                    'directory.form.attributeNo' | translate
                  }}</mat-option>
                </mat-select>
              }
              @case ('date') {
                <input
                  matInput
                  type="date"
                  [formField]="attribute.value"
                  [attr.aria-label]="current.name"
                />
              }
              @default {
                <input
                  matInput
                  type="text"
                  autocomplete="off"
                  [attr.inputmode]="current.type === 'text' ? null : 'decimal'"
                  [formField]="attribute.value"
                  [attr.aria-label]="current.name"
                />
              }
            }
            @if (attribute.value().touched() && attribute.value().invalid()) {
              <mat-error>{{ attribute.value().errors() | fieldError }}</mat-error>
            }
          </mat-form-field>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
    }

    .attributes__header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0 0.5rem;
      margin: 0.25rem 0;
    }

    .attributes__title {
      margin: 0;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
    }

    .attributes__grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
      gap: 0 0.5rem;
      padding-top: 0.25rem;
    }
  `,
})
export class DirectoryAttributeFieldsComponent {
  readonly attributes = input.required<FieldTree<AttributeValueModel[]>>();

  private static nextId = 0;
  protected readonly ids = {
    title: `directory-attributes-${DirectoryAttributeFieldsComponent.nextId}`,
    panel: `directory-attributes-panel-${DirectoryAttributeFieldsComponent.nextId++}`,
  };

  /** Lo que eligió quien carga. Mientras no toque nada, decide cuántos campos hay. */
  protected readonly expanded = signal<boolean | null>(null);

  protected readonly total = computed(() => this.attributes()().value().length);
  protected readonly filled = computed(
    () =>
      this.attributes()()
        .value()
        .filter((attribute) => attribute.value.trim() !== '').length,
  );

  /** Un error que se ve —tocado e inválido— abre el bloque aunque lo hayan plegado. */
  private readonly showsError = computed(() =>
    [...this.attributes()].some((attribute) => {
      const state = attribute.value();
      return state.touched() && state.invalid();
    }),
  );

  protected readonly open = computed(
    () => this.showsError() || (this.expanded() ?? this.total() <= OPEN_UP_TO),
  );
}
