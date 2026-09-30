import { Routes } from '@angular/router';
import { posExitGuard } from './data-access/pos-exit.guard';
import { DirectSalePage } from './pages/direct-sale/direct-sale.page';

/**
 * El punto de venta (`/panel/pos`): la pantalla en la que se **registra** la venta. El listado de las
 * ya registradas vive en `sales.routes.ts`, bajo `/panel/sales`, porque es otra área del panel con
 * otro permiso: acá se exige `order.create` y allá `order.view`. El archivo se llama por su path,
 * igual que `new-purchase.routes.ts` y `purchases.routes.ts` del lado de compras.
 */
export const POS_ROUTES: Routes = [
  {
    path: '',
    title: 'nav.items.pos',
    // Se entra sin preguntar: el punto de venta es la pantalla en la que se trabaja el turno
    // entero, y un cartel entre el clic y el mostrador es una tecla más que apretar cada mañana.
    // La pantalla completa del navegador ya no se toma sola —hay un botón en la barra—, así que
    // entrar no se lleva nada que haya que avisar antes.
    canDeactivate: [posExitGuard],
    component: DirectSalePage,
  },
];
