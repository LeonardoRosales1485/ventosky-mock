import { Component, inject, signal } from '@angular/core';
import {
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

export interface BranchFormDialogResult {
  name: string;
  active: boolean;
}

interface BranchFormModel {
  name: string;
}

const NAME_MAX_LENGTH = 255;

@Component({
  selector: 'app-branch-form-dialog',
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
  templateUrl: './branch-form-dialog.component.html',
  styleUrl: './branch-form-dialog.component.css',
})
export class BranchFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<BranchFormDialogComponent, BranchFormDialogResult>,
  );

  private readonly model = signal<BranchFormModel>({
    name: '',
  });

  protected readonly branchForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
  });

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
        name,
        active: true,
      });
    });
  }
}
