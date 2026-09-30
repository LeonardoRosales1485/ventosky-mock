import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { LanguageService } from './core/i18n/language.service';
import { GlobalProgressBarComponent } from './core/progress/global-progress-bar.component';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, GlobalProgressBarComponent],
  template: `
    <app-global-progress-bar />
    <router-outlet />
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class App {
  constructor() {
    // Eagerly initialize cross-cutting preferences on bootstrap.
    inject(ThemeService);
    inject(LanguageService);
  }
}
