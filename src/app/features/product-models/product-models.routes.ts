import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/unsaved-changes/unsaved-changes.guard';
import { ProductModelFormPage } from './pages/product-model-form/product-model-form.page';

export const PRODUCT_MODELS_ROUTES: Routes = [
  // El modelo ya no tiene listado propio: sus filas viven en el catálogo agrupado de productos
  // (§5.6, wireframe `1a`), que es de donde salen el alta y el lápiz. La raíz queda como redirect
  // en vez de borrarse porque es la que tienen los favoritos y los links viejos.
  {
    path: '',
    pathMatch: 'full',
    redirectTo: '/panel/products',
  },
  // El alta y la edición son la misma pantalla: la diferencia es el `uuid` que trae la ruta. Y una
  // sola pantalla, no un asistente: los tres pasos —datos comunes, ejes, matriz— se ven a la vez.
  {
    path: 'new',
    title: 'productModels.form.createTitle',
    component: ProductModelFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
  {
    // Después de `new`, o «new» se leería como el uuid de un modelo que no existe.
    path: ':uuid',
    title: 'productModels.form.editTitle',
    component: ProductModelFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
];
