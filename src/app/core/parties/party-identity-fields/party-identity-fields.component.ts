import { Component, input } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Field, FormField } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../shared/pipes/field-error.pipe';
import { PARTY_DOC_TYPES, PartyDocType } from '../party.model';

/**
 * Los campos de identidad de un tercero: nombre, documento y condición frente al IVA.
 *
 * Es el mismo bloque en la ficha del cliente, en la del proveedor y en las del empleado, porque todas
 * editan la **misma fila** de `parties`. Tenerlo una sola vez es lo que hace que cada ficha nueva sea
 * mayormente ensamblaje.
 *
 * Recibe los campos ya declarados por el formulario que lo usa: la validación vive con el
 * formulario, no acá, así cada pantalla puede endurecerla sin tocar este componente.
 *
 * **La condición frente al IVA es opcional a propósito.** Sólo influye si le facturamos, así que la
 * preguntan las fichas de cliente y de proveedor y no las de empleado: sin `taxConditionField`, el campo
 * no se dibuja. Por lo mismo, una ficha de persona restringe `docTypes` a CUIL y DNI.
 */
@Component({
  selector: 'app-party-identity-fields',
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './party-identity-fields.component.html',
})
export class PartyIdentityFieldsComponent {
  readonly nameField = input.required<Field<string>>();
  readonly docTypeField = input.required<Field<PartyDocType | ''>>();
  readonly docNumberField = input.required<Field<string>>();
  readonly taxConditionField = input<Field<string> | null>(null);

  /** Los tipos que ofrece el select: los del maestro, o los de una persona. */
  readonly docTypes = input<readonly PartyDocType[]>(PARTY_DOC_TYPES);
  /** «Nombre o razón social» en una ficha fiscal; «Nombre y apellido» en la de una persona. */
  readonly nameLabelKey = input('parties.fields.name');
  /** `organization` para una razón social, `name` para una persona. */
  readonly nameAutocomplete = input('organization');
}
