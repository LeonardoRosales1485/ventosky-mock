import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';
import { LOGIN_ROUTE } from './auth.paths';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureAuthenticated().pipe(
    map((authenticated) => {
      if (authenticated) {
        return true;
      }

      return router.createUrlTree([LOGIN_ROUTE], {
        queryParams: { returnUrl: state.url },
      });
    }),
  );
};
