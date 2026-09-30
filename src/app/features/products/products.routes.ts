import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/unsaved-changes/unsaved-changes.guard';
import { ProductFormPage } from './pages/product-form/product-form.page';
import { ProductsPage } from './pages/products/products.page';

export const PRODUCTS_ROUTES: Routes = [
  {
    path: '',
    component: ProductsPage,
  },
  {
    path: 'new',
    title: 'products.form.createTitle',
    component: ProductFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
  // El alta y la edición son la misma pantalla: la diferencia es el `uuid` que trae la ruta.
  {
    path: ':uuid/edit',
    title: 'products.form.editTitle',
    component: ProductFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
  // No se declara en `PANEL_AREAS`: exige un producto, así que no es un destino al que el buscador
  // global pueda mandar. Se llega desde la solapa Precios del formulario.
  //
  // Se carga aparte del resto del área: es la única pantalla que usa Chart.js, y con un `component`
  // esa librería viajaría en el mismo bundle que el listado de productos.
  {
    path: ':uuid/price-history',
    title: 'products.priceHistory.title',
    loadComponent: () =>
      import('./pages/product-price-history/product-price-history.page').then(
        (page) => page.ProductPriceHistoryPage,
      ),
  },
];
