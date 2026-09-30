import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { HttpBackend, provideHttpClient, withInterceptors } from '@angular/common/http';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TitleStrategy, provideRouter, withRouterConfig } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { routes } from './app.routes';
import { authInterceptor } from './core/http/auth.interceptor';
import { cashRegisterInterceptor } from './core/http/cash-register.interceptor';
import { globalProgressInterceptor } from './core/http/global-progress.interceptor';
import { MatPaginatorI18n } from './core/i18n/mat-paginator-i18n';
import { PageTitleStrategy } from './core/title/page-title.strategy';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MockBackend } from './mock/mock-backend';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Íconos: Material Symbols Rounded (fuente local, `material-symbols/rounded.css`).
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-rounded');
    }),
    // `computed` en vez del `replace` por defecto: cuando un `canDeactivate` cancela una navegación
    // que vino del botón Atrás, restaura la posición real en el historial en lugar de pisar la
    // entrada actual, que dejaba inutilizable el botón Adelante.
    provideRouter(routes, withRouterConfig({ canceledNavigationResolution: 'computed' })),
    provideHttpClient(
      withInterceptors([
        authInterceptor,
        cashRegisterInterceptor,
        globalProgressInterceptor,
      ]),
    ),
    // Rama mock: el backend es `MockBackend`, en el navegador. Tiene que ir después de
    // `provideHttpClient` para pisar el `HttpBackend` que registra.
    { provide: HttpBackend, useClass: MockBackend },
    provideAnimationsAsync(),
    provideTranslateService({
      loader: provideTranslateHttpLoader({
        // Relative so deployments under subpaths (e.g. /blue-productos/) work.
        prefix: 'i18n/',
        suffix: '.json',
      }),
      lang: 'es',
      fallbackLang: 'es',
    }),
    { provide: MatPaginatorIntl, useExisting: MatPaginatorI18n },
    { provide: TitleStrategy, useExisting: PageTitleStrategy },
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline' } },
  ],
};
