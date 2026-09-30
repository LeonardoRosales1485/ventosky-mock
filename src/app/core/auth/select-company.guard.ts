import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';
import { LOGIN_ROUTE, PANEL_HOME_ROUTE } from './auth.paths';

/**
 * Lets authenticated users reach company selection only when they still need to pick one.
 * If a valid company is already selected, sends them to the panel.
 */
export const selectCompanyGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureAuthenticated().pipe(
    map((authenticated) => {
      if (!authenticated) {
        return router.createUrlTree([LOGIN_ROUTE]);
      }

      if (!authService.needsCompanySelection()) {
        return router.createUrlTree([PANEL_HOME_ROUTE]);
      }

      return true;
    }),
  );
};
