import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';

/**
 * La sucursal con la que está operando **este** tab, en la barra superior.
 *
 * Cada tab puede estar en una sucursal distinta (ver `TabContextStore`), así que el dato dejó de ser
 * una preferencia guardada y pasó a ser el contexto de lo que se está mirando: tiene que estar a la
 * vista sin abrir el menú lateral, que en escritorio se colapsa a íconos y en mobile vive detrás de
 * un cajón.
 *
 * No es el selector: cambiar de sucursal sigue siendo cosa del sidebar, que es donde el usuario ya
 * lo busca, y repetir el disparador acá sería ofrecer dos veces la misma acción.
 *
 * Con una sola sucursal no se muestra: no distingue nada.
 */
@Component({
  selector: 'app-branch-chip',
  imports: [MatIconModule, MatTooltipModule, TranslatePipe],
  template: `
    @if (branchName(); as name) {
      <span class="branch-chip" [matTooltip]="name" matTooltipShowDelay="300">
        <mat-icon class="branch-chip__icon" aria-hidden="true">store</mat-icon>
        <span class="sr-only">{{ 'topbar.branch.label' | translate }}:</span>
        <span class="branch-chip__name">{{ name }}</span>
      </span>
    }
  `,
  styleUrl: './branch-chip.component.css',
})
export class BranchChipComponent {
  private readonly auth = inject(AuthService);

  protected readonly branchName = computed(() => {
    if ((this.auth.availableBranches()?.length ?? 0) <= 1) {
      return null;
    }

    return this.auth.selectedBranch()?.name?.trim() || null;
  });
}
