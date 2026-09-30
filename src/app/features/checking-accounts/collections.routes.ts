import { Routes } from '@angular/router';
import { CollectionsPage } from './pages/collections/collections.page';

/** El listado de cobros y pagos registrados (`/panel/collections`). */
export const COLLECTIONS_ROUTES: Routes = [
  {
    path: '',
    component: CollectionsPage,
  },
];
