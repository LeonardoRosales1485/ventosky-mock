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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { form, FormField, maxLength, required, submit, validate } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';

export interface WarehouseFormDialogData {
  warehouse: WarehouseDto | null;
}

export interface WarehouseFormDialogResult {
  uuid?: string;
  name: string;
  /** `null` deja que el backend lo autoasigne al final de la cola de la sucursal. */
  priority: number | null;
  /**
   * Versión que traía el depósito al abrir el diálogo, para que el guardado la reenvíe y el backend
   * pueda detectar si alguien más lo editó mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface WarehouseFormModel {
  name: string;
  priority: number | null;
}

const NAME_MAX_LENGTH = 255;

/** 1 es el depósito que la sucursal vacía primero; no hay prioridad 0 ni negativa. */
const MIN_PRIORITY = 1;

@Component({
  selector: 'app-warehouse-form-dialog',
  imports: [
    MatButtonModule,
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
  templateUrl: './warehouse-form-dialog.component.html',
  styleUrl: './warehouse-form-dialog.component.css',
})
export class WarehouseFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<WarehouseFormDialogComponent, WarehouseFormDialogResult>,
  );
  private readonly data = inject<WarehouseFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = this.data.warehouse !== null;

  private readonly model = signal<WarehouseFormModel>({
    name: this.data.warehouse?.name ?? '',
    priority: this.data.warehouse?.priority ?? null,
  });

  protected readonly warehouseForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);

    // La prioridad es opcional: vacía en el alta significa «poneme al final de la cola».
    validate(path.priority, ({ value }) => {
      const priority = value();
      if (priority === null) {
        return null;
      }

      if (!Number.isInteger(priority)) {
        return { kind: 'integer' };
      }

      return priority < MIN_PRIORITY ? { kind: 'min', min: MIN_PRIORITY } : null;
    });
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.warehouseForm().invalid()) {
      this.warehouseForm().markAsTouched();
      return;
    }

    void submit(this.warehouseForm, async () => {
      const name = this.model().name.trim();
      if (!name) {
        return;
      }

      this.dialogRef.close({
        uuid: this.data.warehouse?.uuid,
        name,
        priority: this.model().priority,
        version: this.data.warehouse?.version,
      });
    });
  }
}
