import { Routes } from '@angular/router';
import { CatalogPage } from './pages/catalog/catalog.page';

/** El catálogo de solo lectura (`/panel/catalog`): una sola pantalla, sin alta ni edición. */
export const CATALOG_ROUTES: Routes = [
  {
    path: '',
    component: CatalogPage,
  },
];
