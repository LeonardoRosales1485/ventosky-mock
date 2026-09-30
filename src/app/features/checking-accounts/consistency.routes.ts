import { Routes } from '@angular/router';
import { CheckingAccountConsistencyPage } from './pages/checking-account-consistency/checking-account-consistency.page';

/**
 * `/panel/settings/checking-account-consistency` — las diferencias entre el cache y las partidas.
 *
 * Una sola pantalla: el listado de lo encontrado, el botón que corre la verificación y el que
 * recalcula una cuenta. No hay ficha de una diferencia porque no hay nada más que decir de una: la
 * fila ya trae el invariante, los dos valores y la resta.
 */
export const CONSISTENCY_ROUTES: Routes = [
  {
    path: '',
    component: CheckingAccountConsistencyPage,
  },
];
