import { Component, computed, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { BranchDto } from '../../../../core/branch/branch.model';
import { DirectoryLink, isEmployeeSpecialty } from '../../../../core/parties/directory-links';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { DirectoryPriceListOption } from '../../data-access/directory-catalog-api.service';
import { DirectoryFormModel } from '../../data-access/directory-forms';

/**
 * Los campos propios de un vínculo: lo que su ABM pregunta y ningún otro.
 *
 * El cliente pide su lista de precios; el proveedor, nada; cada tipo de empleado, el legajo, el ingreso y los
 * datos de su especialidad —el comprador no tiene—. Cuando se le suma una especialidad a alguien que ya es
 * empleado, el legajo, el ingreso y la sucursal ya los tiene, y no se vuelven a pedir (`showEmployment`).
 *
 * Lo que se proyecta va entre el título y los campos: es donde un vínculo que piden los roles dice por qué.
 */
@Component({
  selector: 'app-directory-profile-fields',
  imports: [
    FormField,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './directory-profile-fields.component.html',
  styleUrl: './directory-profile-fields.component.css',
})
export class DirectoryProfileFieldsComponent {
  readonly form = input.required<FieldTree<DirectoryFormModel>>();
  readonly link = input.required<DirectoryLink>();
  /** Pedir legajo, ingreso y sucursal: los del empleado, no los de la especialidad. */
  readonly showEmployment = input(true);
  readonly branches = input<readonly BranchDto[]>([]);
  readonly priceLists = input<readonly DirectoryPriceListOption[]>([]);

  protected readonly isEmployee = computed(() => isEmployeeSpecialty(this.link()));
}
