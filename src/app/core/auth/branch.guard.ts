import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';
import { LOGIN_ROUTE, SELECT_BRANCH_ROUTE } from './auth.paths';

/**
 * Requires a resolved branch context after company selection.
 * Must run after `authGuard` and `companyGuard`.
 * Reuses this tab's own `branchUuid` — inherited from the last one used — when it still belongs
 * to the company. See `TabContextStore`.
 */
export const branchGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureAuthenticated().pipe(
    switchMap((authenticated) => {
      if (!authenticated) {
        return of(router.createUrlTree([LOGIN_ROUTE]));
      }

      return authService.ensureBranchContext().pipe(
        map((result) => {
          if (result === 'select') {
            return router.createUrlTree([SELECT_BRANCH_ROUTE]);
          }
          return true;
        }),
      );
    }),
  );
};
