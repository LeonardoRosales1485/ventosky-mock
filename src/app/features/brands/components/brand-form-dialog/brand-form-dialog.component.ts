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
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { BrandDto } from '../../data-access/brand.model';

export interface BrandFormDialogData {
  brand: BrandDto | null;
}

export interface BrandFormDialogResult {
  uuid?: string;
  name: string;
  /**
   * Versión que traía la marca al abrir el diálogo, para que el guardado la reenvíe y el backend
   * pueda detectar si alguien más la editó mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface BrandFormModel {
  name: string;
}

const NAME_MAX_LENGTH = 255;

@Component({
  selector: 'app-brand-form-dialog',
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
  templateUrl: './brand-form-dialog.component.html',
  styleUrl: './brand-form-dialog.component.css',
})
export class BrandFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<BrandFormDialogComponent, BrandFormDialogResult>,
  );
  private readonly data = inject<BrandFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = this.data.brand !== null;

  private readonly model = signal<BrandFormModel>({
    name: this.data.brand?.name ?? '',
  });

  protected readonly brandForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.brandForm().invalid()) {
      this.brandForm().markAsTouched();
      return;
    }

    void submit(this.brandForm, async () => {
      const name = this.model().name.trim();
      if (!name) {
        return;
      }

      this.dialogRef.close({
        uuid: this.data.brand?.uuid,
        name,
        version: this.data.brand?.version,
      });
    });
  }
}
