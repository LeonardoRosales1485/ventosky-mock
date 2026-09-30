import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfigurationStore } from '../../../../core/configuration/configuration.store';
import { LayoutService } from '../../../../core/layout/layout.service';
import { GlobalSearchService } from '../../components/global-search/global-search.service';
import { SidebarComponent } from '../../components/sidebar/sidebar.component';
import { TopbarComponent } from '../../components/topbar/topbar.component';

@Component({
  selector: 'app-panel-shell-page',
  imports: [
    RouterOutlet,
    MatSidenavModule,
    SidebarComponent,
    TopbarComponent,
  ],
  templateUrl: './panel-shell.page.html',
  styleUrl: './panel-shell.page.css',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class PanelShellPage implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly configuration = inject(ConfigurationStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly globalSearch = inject(GlobalSearchService);
  protected readonly layout = inject(LayoutService);

  /**
   * La configuración del contexto se pide una sola vez, acá: la leen el punto de venta, la compra y
   * el stock, y pedirla en cada pantalla sería el mismo request repetido. Si falla no frena nada —el
   * store queda vacío y sus lecturas responden «no sé»—, así que no se espera a que termine.
   */
  ngOnInit(): void {
    this.configuration.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  protected onSidenavOpenedChange(opened: boolean): void {
    this.layout.setSidebarOpened(opened);
  }

  protected onLogout(): void {
    this.authService.logout({ requireConfirmation: true });
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.globalSearch.open();
    }
  }
}
