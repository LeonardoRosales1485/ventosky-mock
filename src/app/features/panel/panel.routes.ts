import { Routes } from '@angular/router';
import { areaGuard } from './data-access/area.guard';
import { PANEL_AREAS } from './data-access/panel-areas';
import { PanelShellPage } from './pages/panel-shell/panel-shell.page';

/**
 * Los children salen del manifiesto de áreas, que es también de donde el sidebar y el buscador sacan
 * sus ítems: una pantalla nueva se declara una sola vez y aparece en los tres lados a la vez.
 */
export const PANEL_ROUTES: Routes = [
  {
    path: '',
    component: PanelShellPage,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'home',
      },
      ...PANEL_AREAS.map((area) => ({
        path: area.path,
        // El título de la pestaña sale de la misma etiqueta que el sidebar, y las pantallas
        // internas del área lo pisan con el suyo: el más profundo de la cadena es el que gana.
        title: area.labelKey,
        canActivate: [areaGuard(area)],
        loadChildren: area.loadChildren,
      })),
    ],
  },
];
