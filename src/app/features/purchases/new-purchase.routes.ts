import { Routes } from '@angular/router';
import { PurchaseFormPage } from './pages/purchase-form/purchase-form.page';

/**
 * El alta de compra (`/panel/new-purchase`). La pantalla es la misma que la de la edición —lo que
 * las separa es el `uuid` de la ruta—, pero las rutas viven en archivos distintos porque son dos
 * áreas del panel con permisos distintos: acá se exige `purchase.create` y allá `purchase.view`.
 */
export const NEW_PURCHASE_ROUTES: Routes = [
  {
    path: '',
    title: 'purchases.newPurchase.title',
    component: PurchaseFormPage,
  },
];
