import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { LOGIN_ROUTE, PANEL_HOME_ROUTE, SELECT_COMPANY_ROUTE } from './auth.paths';

/**
 * Lets authenticated users reach branch selection only when they still need to pick one.
 * If this tab already has a valid branch (its own or inherited), sends them to the panel.
 */
export const selectBranchGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureAuthenticated().pipe(
    switchMap((authenticated) => {
      if (!authenticated) {
        return of(router.createUrlTree([LOGIN_ROUTE]));
      }

      if (authService.needsCompanySelection()) {
        return of(router.createUrlTree([SELECT_COMPANY_ROUTE]));
      }

      return authService.ensureBranchContext().pipe(
        map((result) => {
          if (result === 'ok') {
            return router.createUrlTree([PANEL_HOME_ROUTE]);
          }
          return true;
        }),
      );
    }),
  );
};
