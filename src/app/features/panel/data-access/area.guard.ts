import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { LOGIN_ROUTE, PANEL_HOME_ROUTE } from '../../../core/auth/auth.paths';
import { PanelArea, canAccessArea } from './panel-areas';

/**
 * Cierra un área del panel cuando falta su permiso, con el mismo predicado que usa el sidebar para
 * decidir si la muestra: entrar por URL a una pantalla que el menú no ofrece termina en el inicio y
 * no en un listado que responde 403.
 *
 * Es un `canActivate` y no un `canMatch` a propósito: los permisos llegan con el `getMe()` que
 * dispara `authGuard`, y `canMatch` corre durante el reconocimiento de la ruta, antes de que el
 * `canActivate` del padre `/panel` haya resuelto. Con `canMatch`, un F5 sobre `/panel/products`
 * evaluaría el permiso contra una sesión todavía vacía y redirigiría de más. Los `canActivate`
 * corren de padre a hijo, así que acá la sesión ya está hidratada.
 */
export function areaGuard(area: PanelArea): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (area.enabled === false) {
      return router.createUrlTree([PANEL_HOME_ROUTE]);
    }

    if (!area.permission && !area.anyPermission) {
      return of(true);
    }

    return authService.ensureAuthenticated().pipe(
      map((authenticated) => {
        if (!authenticated) {
          return router.createUrlTree([LOGIN_ROUTE]);
        }

        return canAccessArea(area, authService) || router.createUrlTree([PANEL_HOME_ROUTE]);
      }),
    );
  };
}
