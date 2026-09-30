import { Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { LayoutService } from '../../../../core/layout/layout.service';
import { NavService } from '../../data-access/nav.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { UpperCasePipe } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { POS_PATH } from '../../../sales/sales.paths';

@Component({
  selector: 'app-sidebar',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    UpperCasePipe,
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
  host: {
    class: 'block h-full',
    '[class.sidebar--collapsed]': '!showLabels()',
  },
})
export class SidebarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly layout = inject(LayoutService);
  protected readonly nav = inject(NavService);

  private readonly translate = inject(TranslateService);

  /** Cerrar sesión: el shell lo resuelve (pide confirmación). */
  readonly logout = output<void>();

  protected readonly user = computed(() => this.auth.authUser());

  protected readonly selectedCompany = computed(() => {
    const uuid = this.auth.selectedCompanyUuid();
    if (!uuid) {
      return null;
    }

    return this.auth.companies().find((company) => company.companyUuid === uuid) ?? null;
  });

  protected readonly companyName = computed(() => this.selectedCompany()?.companyName ?? null);

  protected readonly companyLabel = computed(
    () => this.companyName() || this.translate.instant('auth.selectCompany.unnamed'),
  );

  /**
   * El rol que se muestra bajo el usuario: el primero de la empresa activa (o de la empresa sistema,
   * que es donde vive el sysadmin), con nombre legible si el rol es uno conocido.
   */
  protected readonly roleLabel = computed(() => {
    const dto = this.user();
    if (!dto) {
      return null;
    }
    const companyUuid = this.auth.selectedCompanyUuid();
    const company =
      dto.userCompanyRoles.find((c) => c.companyUuid === companyUuid) ?? dto.userCompanyRoles[0];
    const role = company?.roles[0]?.name;
    if (!role) {
      return null;
    }
    const key = `nav.roleNames.${role}`;
    const translated = this.translate.instant(key);
    return translated !== key ? translated : role.charAt(0) + role.slice(1).toLowerCase();
  });

  protected readonly branchName = computed(() => this.auth.selectedBranch()?.name ?? null);

  /**
   * Sucursales de la empresa activa. Con una sola no hay nada que elegir, así que el encabezado se
   * queda como estaba: ofrecer el cambio sería anunciar una acción que no lleva a ningún lado.
   */
  protected readonly switchableBranches = computed(() => this.auth.availableBranches() ?? []);

  /** Full labels in mobile overlay or desktop expanded; icon-only on desktop rail. */
  protected readonly showLabels = computed(
    () => this.layout.isMobile() || !this.layout.sidebarCollapsed(),
  );

  protected readonly sections = this.nav.sections;

  /** Las pantallas que abren en modo inmersivo (sin sidebar) llevan un ícono que lo anticipa. */
  protected isImmersive(route: string): boolean {
    return route === POS_PATH;
  }

  protected onNavigate(): void {
    this.layout.closeMobileSidebar();
  }

  /**
   * Elegir la sucursal en la que ya se está no hace nada: el menú se cierra y listo. Para cualquier
   * otra, `switchBranch` recarga la aplicación entera, así que no hay nada que limpiar acá.
   */
  protected onSwitchBranch(branchUuid: string): void {
    this.auth.switchBranch(branchUuid);
  }
}
