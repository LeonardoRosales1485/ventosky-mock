import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { form, FormField, maxLength, required, submit } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ATTRIBUTE_VALUE_TYPES,
  AttributeValueType,
  DEFAULT_ATTRIBUTE_VALUE_TYPE,
  isAttributeValueType,
} from '../../../../core/attributes/attribute-value-type';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { EmployeeAttributeDto } from '../../data-access/employee-attribute.model';

/** Lo que el usuario había escrito, para reabrir el formulario cuando el guardado lo rechazó. */
export interface EmployeeAttributeDraft {
  name: string;
  type: AttributeValueType;
}

export interface EmployeeAttributeFormDialogData {
  attribute: EmployeeAttributeDto | null;
  draft?: EmployeeAttributeDraft;
}

export interface EmployeeAttributeFormDialogResult extends EmployeeAttributeDraft {
  uuid?: string;
  /** Versión que traía el campo al abrir el diálogo. Ausente en un alta. */
  version?: number;
}

/** El mismo tope que valida `EmployeeAttributeService`. */
const NAME_MAX_LENGTH = 100;

/**
 * Alta y edición de un campo extra: un nombre y un tipo.
 *
 * El tipo se puede elegir también al editar, pero el backend lo rechaza si el campo ya está
 * completado en algún empleado: el listado no trae cuántos lo tienen, así que el aviso va como
 * ayuda del campo y el rechazo lo resuelve la página.
 */
@Component({
  selector: 'app-employee-attribute-form-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './employee-attribute-form-dialog.component.html',
  styleUrl: './employee-attribute-form-dialog.component.css',
})
export class EmployeeAttributeFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<EmployeeAttributeFormDialogComponent, EmployeeAttributeFormDialogResult>,
  );
  private readonly data = inject<EmployeeAttributeFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = this.data.attribute !== null;
  protected readonly types = ATTRIBUTE_VALUE_TYPES;

  private readonly model = signal<EmployeeAttributeDraft>(initialModel(this.data));

  protected readonly attributeForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
    required(path.type);
  });

  protected onTypeChange(type: AttributeValueType): void {
    this.attributeForm.type().value.set(type);
    this.attributeForm.type().markAsTouched();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.attributeForm().invalid()) {
      this.attributeForm().markAsTouched();
      return;
    }

    void submit(this.attributeForm, async () => {
      const name = this.model().name.trim();
      if (!name) {
        return;
      }

      this.dialogRef.close({
        uuid: this.data.attribute?.uuid,
        name,
        type: this.model().type,
        version: this.data.attribute?.version,
      });
    });
  }
}

function initialModel(data: EmployeeAttributeFormDialogData): EmployeeAttributeDraft {
  if (data.draft) {
    return { ...data.draft };
  }

  const type = data.attribute?.type ?? '';
  return {
    name: data.attribute?.name ?? '',
    // Un tipo que el front no conoce (agregado por una versión más nueva del backend) se muestra
    // como texto; guardarlo así lo cambiaría, y el backend lo rechaza si el campo tiene valores.
    type: isAttributeValueType(type) ? type : DEFAULT_ATTRIBUTE_VALUE_TYPE,
  };
}
