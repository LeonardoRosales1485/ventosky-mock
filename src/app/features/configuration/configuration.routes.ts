import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../core/unsaved-changes/unsaved-changes.guard';
import { ConfigurationPage } from './pages/configuration/configuration.page';

export const CONFIGURATION_ROUTES: Routes = [
  {
    path: '',
    component: ConfigurationPage,
    // Se guarda de a una solapa: cambiar de solapa no guarda nada, así que irse de la pantalla con
    // cambios pendientes los pierde sin más aviso que éste.
    canDeactivate: [unsavedChangesGuard],
  },
];
