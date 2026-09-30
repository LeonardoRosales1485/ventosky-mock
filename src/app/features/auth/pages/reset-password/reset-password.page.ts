import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../../../core/auth/auth-api.service';
import { LOGIN_ROUTE } from '../../../../core/auth/auth.paths';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import {
  code,
  emailAddress,
  password,
  passwordMatch,
} from '../../../../shared/utils/signal-validators';
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';

/** Matches `BaseUserService.forgotPassword` alphanumeric code length. */
const CODE_LENGTH = 32;

interface ResetPasswordModel {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-reset-password-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    AuthLayoutComponent,
  ],
  templateUrl: './reset-password.page.html',
  styleUrl: './reset-password.page.css',
})
export class ResetPasswordPage {
  private readonly authApi = inject(AuthApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly codeLength = CODE_LENGTH;
  protected readonly submitting = signal(false);

  private readonly model = signal<ResetPasswordModel>({
    email: this.queryParam('email'),
    code: this.queryParam('code').toUpperCase(),
    password: '',
    confirmPassword: '',
  });

  protected readonly resetForm = form(this.model, (path) => {
    emailAddress(path.email);
    code(path.code, { length: CODE_LENGTH });
    password(path.password);
    required(path.confirmPassword);
    passwordMatch(path.confirmPassword, path.password);
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    void submit(this.resetForm, async () => {
      const { email, code: resetCode, password: newPassword } = this.model();
      this.submitting.set(true);

      try {
        await firstValueFrom(
          this.authApi.resetPassword({
            email: email.trim(),
            code: resetCode.trim().toUpperCase(),
            password: newPassword,
          }),
        );
        this.toast.success(this.translate.instant('auth.resetPassword.success'));
        await this.router.navigateByUrl(LOGIN_ROUTE);
      } catch (error: unknown) {
        this.toast.error(
          resolveApiErrorMessage(
            error,
            this.translate.instant('auth.resetPassword.error'),
          ),
        );
      } finally {
        this.submitting.set(false);
      }
    });
  }

  private queryParam(name: string): string {
    return this.route.snapshot.queryParamMap.get(name)?.trim() ?? '';
  }
}
