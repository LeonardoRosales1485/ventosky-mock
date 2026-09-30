import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_VERSION } from '../../../core/version/app-version';
import { BackendVersionService } from '../../../core/version/backend-version.service';

/**
 * Pie con la versión del front y la del backend.
 *
 * La del backend puede no estar (respuesta pendiente o fallida) y en ese caso no se muestra nada
 * en su lugar: un "—" sólo agregaría ruido a un dato accesorio.
 */
@Component({
  selector: 'app-version-info',
  imports: [TranslatePipe],
  host: { class: 'block text-center' },
  template: `
    <p class="text-xs text-[var(--mat-sys-on-surface-variant)]">
      {{ 'version.app' | translate: { version: appVersion } }}
      @if (backendVersion(); as backend) {
        <span aria-hidden="true">&nbsp;·&nbsp;</span>
        {{ 'version.api' | translate: { version: backend } }}
      }
    </p>
  `,
})
export class VersionInfoComponent {
  protected readonly appVersion = APP_VERSION;
  protected readonly backendVersion = inject(BackendVersionService).version;
}
