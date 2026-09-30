import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { form, FormField, submit } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AuthApi } from '../../../../core/auth/auth-api.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { emailAddress } from '../../../../shared/utils/signal-validators';
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';

interface ForgotPasswordModel {
  email: string;
}

@Component({
  selector: 'app-forgot-password-page',
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
  templateUrl: './forgot-password.page.html',
  styleUrl: './forgot-password.page.css',
})
export class ForgotPasswordPage {
  private readonly authApi = inject(AuthApi);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  private readonly model = signal<ForgotPasswordModel>({
    email: '',
  });

  protected readonly forgotForm = form(this.model, (path) => {
    emailAddress(path.email);
  });

  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);

  protected onSubmit(event: Event): void {
    event.preventDefault();

    void submit(this.forgotForm, async () => {
      const email = this.model().email.trim();
      this.submitting.set(true);

      try {
        await firstValueFrom(this.authApi.requestPasswordReset({ email }));
        this.submitted.set(true);
      } catch (error: unknown) {
        this.toast.error(
          resolveApiErrorMessage(
            error,
            this.translate.instant('auth.forgotPassword.error'),
          ),
        );
      } finally {
        this.submitting.set(false);
      }
    });
  }
}
