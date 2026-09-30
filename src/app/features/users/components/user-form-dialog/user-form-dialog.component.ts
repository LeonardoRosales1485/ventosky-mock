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
  email,
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import {
  EMAIL_MAX_LENGTH,
  password,
  username,
} from '../../../../shared/utils/signal-validators';
import { UserDto } from '../../data-access/user.model';

export interface UserFormDialogData {
  user: UserDto | null;
  /** Company UUID to attach on create. */
  companyUuid: string;
}

export interface UserFormDialogResult {
  uuid?: string;
  username: string;
  email: string;
  phone: string;
  password?: string;
  userCompanyRoles?: UserDto['userCompanyRoles'];
  /**
   * Versión que traía el usuario al abrir el diálogo, para que el guardado la reenvíe y el backend
   * pueda detectar si alguien más lo editó mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface UserFormModel {
  username: string;
  email: string;
  phone: string;
  password: string;
}

@Component({
  selector: 'app-user-form-dialog',
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
  templateUrl: './user-form-dialog.component.html',
  styleUrl: './user-form-dialog.component.css',
})
export class UserFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<UserFormDialogComponent, UserFormDialogResult>,
  );
  private readonly data = inject<UserFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = this.data.user !== null;

  private readonly model = signal<UserFormModel>({
    username: this.data.user?.username ?? '',
    email: this.data.user?.email ?? '',
    phone: this.data.user?.phone ?? '',
    password: '',
  });

  protected readonly userForm = form(this.model, (path) => {
    username(path.username);

    required(path.email);
    email(path.email);
    maxLength(path.email, EMAIL_MAX_LENGTH);

    maxLength(path.phone, 40);

    if (!this.isEdit) {
      password(path.password);
    }
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.userForm().invalid()) {
      this.userForm().markAsTouched();
      return;
    }

    void submit(this.userForm, async () => {
      const value = this.model();
      const usernameValue = value.username.trim();
      const emailValue = value.email.trim();
      const phoneValue = value.phone.trim();
      const passwordValue = value.password;

      if (!usernameValue || !emailValue) {
        return;
      }

      if (!this.isEdit && !passwordValue) {
        return;
      }

      const result: UserFormDialogResult = {
        uuid: this.data.user?.uuid,
        username: usernameValue,
        email: emailValue,
        phone: phoneValue,
        userCompanyRoles:
          this.data.user?.userCompanyRoles ??
          (this.data.companyUuid
            ? [{ companyUuid: this.data.companyUuid, roles: [] }]
            : undefined),
        version: this.data.user?.version,
      };

      if (!this.isEdit && passwordValue) {
        result.password = passwordValue;
      }

      this.dialogRef.close(result);
    });
  }
}
