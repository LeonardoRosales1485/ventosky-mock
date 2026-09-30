import { Routes } from '@angular/router';
import { PurchasesPage } from './pages/purchases/purchases.page';

/**
 * El listado de compras realizadas (`/panel/purchases`) y la edición de una de sus filas. El alta
 * vive en su propio archivo de rutas —`new-purchase.routes.ts`, bajo `/panel/new-purchase`— porque
 * es otra área del panel: ésta se abre con `purchase.view` y aquélla con `purchase.create`.
 */
export const PURCHASES_ROUTES: Routes = [
  {
    path: '',
    component: PurchasesPage,
  },
  /*
   * La edición cuelga del listado y no del alta porque es de acá que se llega, y porque el permiso
   * que exige —`purchase.edit`— no tiene nada que ver con el de crear. Sólo alcanza a la orden de
   * compra borrador: es lo único que el backend deja editar (`POST /order/{uuid}/convert`).
   *
   * Se carga aparte y no con `component`: es la pantalla del alta, que vive en el chunk de la otra
   * área, y referenciarla en duro metería el formulario entero dentro del bundle del listado.
   */
  {
    path: ':uuid/edit',
    title: 'purchases.editPurchase.title',
    loadComponent: () =>
      import('./pages/purchase-form/purchase-form.page').then((page) => page.PurchaseFormPage),
  },
];
