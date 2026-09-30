import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';

interface LoginModel {
  username: string;
  password: string;
  remember: boolean;
}

@Component({
  selector: 'app-login-page',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
    AuthLayoutComponent,
  ],
  templateUrl: './login.page.html',
  styleUrl: './login.page.css',
})
export class LoginPage {
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  private readonly model = signal<LoginModel>({
    username: '',
    password: '',
    remember: false,
  });

  protected readonly loginForm = form(this.model, (path) => {
    required(path.username);
    required(path.password);
  });

  protected onSubmit(event: Event): void {
    event.preventDefault();

    void submit(this.loginForm, async () => {
      const { username, password } = this.model();

      try {
        await firstValueFrom(
          this.authService.login({ username: username.trim(), password }),
        );
      } catch {
        this.toast.error(this.translate.instant('auth.login.error'));
      }
    });
  }
}
