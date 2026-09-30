import { Routes } from '@angular/router';
import { SalesPage } from './pages/sales/sales.page';

/**
 * «Mis compras» (`/panel/my-purchases`): el portal del cliente. Es el mismo listado de ventas, en modo
 * `own`: el backend ya acota `/order/paginate` a las operaciones cuya contraparte es la ficha del usuario
 * —quien sólo tiene `order.view_own` no ve otras—, así que la pantalla no filtra nada; lo que hace es no
 * ofrecer lo que no tiene sentido para el cliente: la columna y el filtro de cliente, y el alta.
 */
export const MY_PURCHASES_ROUTES: Routes = [
  {
    path: '',
    component: SalesPage,
    data: { mode: 'own' },
  },
];
