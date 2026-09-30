import { Routes } from '@angular/router';
import { PurchasesPage } from './pages/purchases/purchases.page';

/**
 * «Mis ventas» (`/panel/my-sales`): el portal del proveedor. Es el listado de compras en modo `own`: el
 * backend ya acota `/order/paginate` a las compras que la empresa le hizo a la ficha del usuario —quien
 * sólo tiene `purchase.view_own` no ve otras—, y la pantalla no ofrece la columna ni el filtro de
 * proveedor, ni el alta ni la edición, que son de la empresa.
 */
export const MY_SALES_ROUTES: Routes = [
  {
    path: '',
    component: PurchasesPage,
    data: { mode: 'own' },
  },
];
