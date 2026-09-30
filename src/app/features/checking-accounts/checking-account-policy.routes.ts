import { Routes } from '@angular/router';

/**
 * `/panel/settings/checking-accounts` — la política de cuenta corriente de la empresa.
 *
 * Vive bajo `settings` y no junto al listado de cuentas porque no es una consulta de operación: es
 * algo que se configura una vez y rige para todos los titulares. El listado se mira todos los días;
 * esto, cuando cambian las condiciones comerciales.
 */
export const CHECKING_ACCOUNT_POLICY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/checking-account-policy/checking-account-policy.page').then(
        (page) => page.CheckingAccountPolicyPage,
      ),
  },
];
