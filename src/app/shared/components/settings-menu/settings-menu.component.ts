import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService, type AppLanguage } from '../../../core/i18n/language.service';
import { ThemeService } from '../../../core/theme/theme.service';

@Component({
  selector: 'app-settings-menu',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
    TranslatePipe,
  ],
  templateUrl: './settings-menu.component.html',
  styleUrl: './settings-menu.component.css',
})
export class SettingsMenuComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly language = inject(LanguageService);

  protected onLanguageChange(lang: AppLanguage): void {
    this.language.setLanguage(lang);
  }
}
