import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { branchGuard } from './core/auth/branch.guard';
import { companyGuard } from './core/auth/company.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'panel',
  },
  {
    // Legacy path used by password-recovery emails (`/forgot-password?code=&email=`).
    path: 'forgot-password',
    redirectTo: 'auth/reset-password',
  },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: 'panel',
    canActivate: [authGuard, companyGuard, branchGuard],
    loadChildren: () => import('./features/panel/panel.routes').then((m) => m.PANEL_ROUTES),
  },
];
