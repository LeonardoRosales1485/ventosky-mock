import { Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { BranchDto } from '../../../../core/branch/branch.model';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';

export interface BranchFormDialogData {
  branch: BranchDto | null;
}

export interface BranchFormDialogResult {
  uuid?: string;
  name: string;
  active: boolean;
  /** El domicilio que imprime el remito de traslado. Vacío viaja como `null`. */
  address: string | null;
  /**
   * Versión que traía la sucursal al abrir el diálogo, para que el guardado la reenvíe y el backend
   * pueda detectar si alguien más la editó mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface BranchFormModel {
  name: string;
  active: boolean;
  address: string;
}

const NAME_MAX_LENGTH = 255;
const ADDRESS_MAX_LENGTH = 255;

@Component({
  selector: 'app-branches-form-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './branch-form-dialog.component.html',
  styleUrl: './branch-form-dialog.component.css',
})
export class BranchFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<BranchFormDialogComponent, BranchFormDialogResult>,
  );
  private readonly data = inject<BranchFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = this.data.branch !== null;

  private readonly model = signal<BranchFormModel>({
    name: this.data.branch?.name ?? '',
    active: this.data.branch?.active ?? true,
    address: this.data.branch?.address ?? '',
  });

  protected readonly branchForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);

    // El domicilio es opcional: una sucursal sin dirección cargada sigue operando, sólo que su
    // remito de traslado sale sin ella.
    maxLength(path.address, ADDRESS_MAX_LENGTH);
  });

  protected onActiveChange(checked: boolean): void {
    this.branchForm.active().value.set(checked);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.branchForm().invalid()) {
      this.branchForm().markAsTouched();
      return;
    }

    void submit(this.branchForm, async () => {
      const name = this.model().name.trim();
      if (!name) {
        return;
      }

      this.dialogRef.close({
        uuid: this.data.branch?.uuid,
        name,
        active: this.model().active,
        address: this.model().address.trim() || null,
        version: this.data.branch?.version,
      });
    });
  }
}
