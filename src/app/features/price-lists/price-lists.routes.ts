import { Routes } from '@angular/router';
import { PriceListPricesPage } from './pages/price-list-prices/price-list-prices.page';
import { PriceListsPage } from './pages/price-lists/price-lists.page';

export const PRICE_LISTS_ROUTES: Routes = [
  {
    path: '',
    component: PriceListsPage,
  },
  // No se declara en `PANEL_AREAS`: exige una lista, así que no es un destino al que el buscador
  // global pueda mandar. Se llega desde «Ver precios» del listado.
  {
    path: ':uuid/prices',
    title: 'priceLists.prices.title',
    component: PriceListPricesPage,
  },
];
