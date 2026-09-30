import { Routes } from '@angular/router';
import { SalesPage } from './pages/sales/sales.page';

/**
 * El listado de las ventas realizadas (`/panel/sales`): el plural que el punto de venta dejó libre a
 * propósito. El alta vive en `pos.routes.ts` —bajo `/panel/pos`— porque es otra área del panel: ésta
 * se abre con `order.view` y aquélla con `order.create`.
 *
 * No cuelga de acá ninguna edición, al revés que en compras: una venta es un commit atómico y el
 * backend no acepta ninguna escritura sobre ella —`/order/save` responde 410 y el convert sólo
 * alcanza a una orden de compra borrador—.
 */
export const SALES_ROUTES: Routes = [
  {
    path: '',
    component: SalesPage,
  },
];
