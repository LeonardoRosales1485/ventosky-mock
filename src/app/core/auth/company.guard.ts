import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';
import { LOGIN_ROUTE, SELECT_COMPANY_ROUTE } from './auth.paths';

/**
 * Requires an authenticated session and a resolved company context.
 * Must run after `authGuard` (or call `ensureAuthenticated` itself).
 */
export const companyGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureAuthenticated().pipe(
    map((authenticated) => {
      if (!authenticated) {
        return router.createUrlTree([LOGIN_ROUTE]);
      }

      if (authService.needsCompanySelection()) {
        return router.createUrlTree([SELECT_COMPANY_ROUTE]);
      }

      return true;
    }),
  );
};
