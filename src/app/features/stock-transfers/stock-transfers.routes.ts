import { Routes } from '@angular/router';
import { StockTransfersPage } from './pages/stock-transfers/stock-transfers.page';

/**
 * El área `/panel/stock-transfers`: el listado, el despacho de uno nuevo, el detalle de uno y su
 * remito.
 *
 * Sólo el listado entra con `component`. Las otras tres se cargan aparte porque quien abre el
 * listado no siempre despacha ni imprime, y el formulario arrastra el selector de productos y el
 * diálogo de lotes.
 *
 * `new` va **antes** de `:uuid`: el router toma la primera que matchea, y al revés «new» se leería
 * como el uuid de un traslado.
 */
export const STOCK_TRANSFERS_ROUTES: Routes = [
  {
    path: '',
    component: StockTransfersPage,
  },
  {
    path: 'new',
    title: 'stockTransfers.form.title',
    loadComponent: () =>
      import('./pages/stock-transfer-form/stock-transfer-form.page').then(
        (page) => page.StockTransferFormPage,
      ),
  },
  {
    path: ':uuid/remito',
    title: 'stockTransfers.remito.title',
    loadComponent: () =>
      import('./pages/stock-transfer-remito/stock-transfer-remito.page').then(
        (page) => page.StockTransferRemitoPage,
      ),
  },
  {
    path: ':uuid',
    title: 'stockTransfers.detail.title',
    loadComponent: () =>
      import('./pages/stock-transfer-detail/stock-transfer-detail.page').then(
        (page) => page.StockTransferDetailPage,
      ),
  },
];
