import { Routes } from '@angular/router';
import { ExpirationsPage } from './pages/expirations/expirations.page';

/**
 * El área `/panel/stock`: el panel de vencimientos, la trazabilidad de una partida y la consulta por
 * número de serie.
 *
 * `batch/:uuid` exige un lote, así que no se declara en `PANEL_AREAS`: se llega desde el panel, la
 * ficha del producto o el detalle de una operación, nunca desde el buscador global. `serial` sí es
 * una pantalla de entrada —se llega con la etiqueta en la mano— y por eso va al menú.
 */
export const STOCK_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'expirations',
  },
  {
    path: 'expirations',
    component: ExpirationsPage,
  },
  {
    // La consulta de postventa. Acepta el número en la ruta —así la ficha del producto puede
    // enlazar una serie concreta— y también se abre vacía desde el menú, que es como llega quien
    // tiene la etiqueta en la mano y todavía no la escaneó.
    path: 'serial',
    title: 'stock.serial.title',
    loadComponent: () =>
      import('./pages/serial-lookup/serial-lookup.page').then((page) => page.SerialLookupPage),
  },
  {
    path: 'serial/:serialNumber',
    title: 'stock.serial.title',
    loadComponent: () =>
      import('./pages/serial-lookup/serial-lookup.page').then((page) => page.SerialLookupPage),
  },
  {
    path: 'batch/:uuid',
    title: 'stock.batch.title',
    loadComponent: () =>
      import('./pages/batch-traceability/batch-traceability.page').then(
        (page) => page.BatchTraceabilityPage,
      ),
  },
];
