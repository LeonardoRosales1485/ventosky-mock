import { Routes } from '@angular/router';
import { NewCollectionPage } from './pages/new-collection/new-collection.page';

/**
 * El alta de cobro o pago (`/panel/new-collection`). Es área propia y no una pantalla interna del
 * listado por lo mismo que «Nueva compra» no vive bajo «Compras»: el permiso que la abre es el de
 * cobrar, no el de consultar.
 */
export const NEW_COLLECTION_ROUTES: Routes = [
  {
    path: '',
    title: 'checkingAccounts.newCollection.title',
    component: NewCollectionPage,
  },
];
