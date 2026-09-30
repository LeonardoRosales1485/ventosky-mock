import { Routes } from '@angular/router';
import { authGuard } from '../../core/auth/auth.guard';
import { selectBranchGuard } from '../../core/auth/select-branch.guard';
import { selectCompanyGuard } from '../../core/auth/select-company.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'login',
    title: 'auth.login.title',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'forgot-password',
    title: 'auth.forgotPassword.title',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    title: 'auth.resetPassword.title',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'select-company',
    title: 'auth.selectCompany.title',
    canActivate: [authGuard, selectCompanyGuard],
    loadComponent: () =>
      import('./pages/select-company/select-company.page').then((m) => m.SelectCompanyPage),
  },
  {
    path: 'select-branch',
    title: 'auth.selectBranch.title',
    canActivate: [authGuard, selectBranchGuard],
    loadComponent: () =>
      import('./pages/select-branch/select-branch.page').then((m) => m.SelectBranchPage),
  },
];
