import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/unsaved-changes/unsaved-changes.guard';
import { PromotionFormPage } from './pages/promotion-form/promotion-form.page';
import { PromotionsPage } from './pages/promotions/promotions.page';

export const PROMOTIONS_ROUTES: Routes = [
  {
    path: '',
    component: PromotionsPage,
  },
  {
    path: 'new',
    title: 'promotions.form.createTitle',
    component: PromotionFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
  // El alta y la edición son la misma pantalla: la diferencia es el `uuid` que trae la ruta.
  {
    path: ':uuid/edit',
    title: 'promotions.form.editTitle',
    component: PromotionFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
];
