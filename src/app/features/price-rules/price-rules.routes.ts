import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/unsaved-changes/unsaved-changes.guard';
import { PriceRuleFormPage } from './pages/price-rule-form/price-rule-form.page';
import { PriceRulesPage } from './pages/price-rules/price-rules.page';

export const PRICE_RULES_ROUTES: Routes = [
  {
    path: '',
    component: PriceRulesPage,
  },
  {
    path: 'new',
    title: 'priceRules.form.createTitle',
    component: PriceRuleFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
  // El alta y la edición son la misma pantalla: la diferencia es el `uuid` que trae la ruta.
  {
    path: ':uuid/edit',
    title: 'priceRules.form.editTitle',
    component: PriceRuleFormPage,
    canDeactivate: [unsavedChangesGuard],
  },
];
