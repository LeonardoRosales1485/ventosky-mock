import { Routes } from '@angular/router';
import { AssembliesPage } from './pages/assemblies/assemblies.page';

/**
 * El área `/panel/assemblies`: el listado, el alta de un armado, el desarme y la trazabilidad.
 *
 * Sólo el listado entra con `component`. Las otras tres se cargan aparte porque quien consulta los
 * armados no siempre arma ni desarma, y el formulario arrastra el selector de productos y el
 * precálculo en vivo.
 *
 * `new`, `disassemble` y `traceability` van **antes** que cualquier ruta con parámetro: el router
 * toma la primera que matchea.
 */
export const ASSEMBLIES_ROUTES: Routes = [
  {
    path: '',
    component: AssembliesPage,
  },
  {
    path: 'new',
    title: 'assemblies.form.title',
    loadComponent: () =>
      import('./pages/assembly-form/assembly-form.page').then((page) => page.AssemblyFormPage),
  },
  {
    path: 'disassemble',
    title: 'assemblies.disassemble.title',
    loadComponent: () =>
      import('./pages/assembly-disassemble/assembly-disassemble.page').then(
        (page) => page.AssemblyDisassemblePage,
      ),
  },
  {
    path: 'traceability',
    title: 'assemblies.traceability.title',
    loadComponent: () =>
      import('./pages/assembly-traceability/assembly-traceability.page').then(
        (page) => page.AssemblyTraceabilityPage,
      ),
  },
];
