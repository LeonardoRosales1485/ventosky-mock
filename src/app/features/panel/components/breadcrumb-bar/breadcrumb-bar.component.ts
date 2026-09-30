import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BREADCRUMB_HOME, BreadcrumbItem } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { NavService } from '../../data-access/nav.service';

/**
 * El rastro de la barra superior: `Sucursal › Pantalla › Detalle`.
 *
 * Arranca por la sucursal activa —la Propuesta B la usa como raíz— y sigue con lo que declaró la
 * pantalla en {@link BreadcrumbService}, sin el «Inicio» inicial (la sucursal ya hace de raíz). Una
 * pantalla que no declara rastro muestra el nombre de su ítem del menú, así la barra nunca queda
 * vacía.
 */
@Component({
  selector: 'app-breadcrumb-bar',
  imports: [RouterLink, TranslatePipe, MatIconModule],
  templateUrl: './breadcrumb-bar.component.html',
  styleUrl: './breadcrumb-bar.component.css',
})
export class BreadcrumbBarComponent {
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavService);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly branchName = computed(() => this.auth.selectedBranch()?.name ?? null);

  protected readonly trail = computed<readonly BreadcrumbItem[]>(() => {
    const items = this.breadcrumb.items();
    if (items.length) {
      const withoutHome = items[0]?.link === BREADCRUMB_HOME.link && items.length > 1 ? items.slice(1) : items;
      return withoutHome;
    }
    const path = this.url().split('?')[0];
    const match = this.nav
      .sections()
      .flatMap((section) => section.items)
      .filter((item) => path === item.route || path.startsWith(`${item.route}/`))
      .sort((a, b) => b.route.length - a.route.length)[0];
    return match ? [{ labelKey: match.labelKey }] : [];
  });
}
