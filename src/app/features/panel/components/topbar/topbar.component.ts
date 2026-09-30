import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { DashboardService } from '../../../../core/dashboard/dashboard.service';
import { LayoutService } from '../../../../core/layout/layout.service';
import { SettingsMenuComponent } from '../../../../shared/components/settings-menu/settings-menu.component';
import { BreadcrumbBarComponent } from '../breadcrumb-bar/breadcrumb-bar.component';
import { GlobalSearchService } from '../global-search/global-search.service';

/**
 * La barra superior de 64px: rastro a la izquierda; buscador, estado de la caja, avisos y ajustes a
 * la derecha. La marca y la sucursal viven en el sidebar; cerrar sesión, en el bloque del usuario.
 */
@Component({
  selector: 'app-topbar',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    SettingsMenuComponent,
    BreadcrumbBarComponent,
  ],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.css',
})
export class TopbarComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly globalSearch = inject(GlobalSearchService);

  protected readonly layout = inject(LayoutService);
  protected readonly dashboard = inject(DashboardService);
  protected readonly shortcutLabel = this.resolveShortcutLabel();

  ngOnInit(): void {
    this.dashboard.refreshShell();
  }

  protected openSearch(): void {
    this.globalSearch.open();
  }

  private resolveShortcutLabel(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return 'Ctrl K';
    }

    const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    return isApple ? '⌘K' : 'Ctrl K';
  }
}
