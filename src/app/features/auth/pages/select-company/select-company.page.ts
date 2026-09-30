import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { AuthUserCompanyRole } from '../../../../core/auth/auth.models';
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';

@Component({
  selector: 'app-select-company-page',
  imports: [MatIconModule, MatListModule, TranslatePipe, AuthLayoutComponent],
  templateUrl: './select-company.page.html',
  styleUrl: './select-company.page.css',
})
export class SelectCompanyPage {
  private readonly authService = inject(AuthService);

  protected readonly companies = this.authService.companies;

  protected selectCompany(company: AuthUserCompanyRole): void {
    this.authService.selectCompany(company.companyUuid);
  }
}
