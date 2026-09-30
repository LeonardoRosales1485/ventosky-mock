import { Routes } from '@angular/router';
import { CheckingAccountsPage } from './pages/checking-accounts/checking-accounts.page';

/**
 * El área `/panel/checking-accounts`: el listado de cuentas y el estado de cuenta de una de ellas.
 *
 * La ficha se carga aparte y no con `component` porque es la pantalla más grande del módulo —tres
 * pestañas, cuatro diálogos— y quien entra al listado no siempre abre una cuenta.
 */
export const CHECKING_ACCOUNTS_ROUTES: Routes = [
  {
    path: '',
    component: CheckingAccountsPage,
  },
  {
    path: ':uuid',
    title: 'checkingAccounts.detail.title',
    loadComponent: () =>
      import('./pages/checking-account-detail/checking-account-detail.page').then(
        (page) => page.CheckingAccountDetailPage,
      ),
  },
];
