import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { PANEL_HOME_ROUTE } from '../../core/auth/auth.paths';
import { AuthService } from '../../core/auth/auth.service';
import { isDirectoryFolderId, visibleDirectoryFolders } from './data-access/directory-folders';
import { directoryFolderRoute } from './directory.paths';
import { DirectoryPage } from './pages/directory/directory.page';

/**
 * La carpeta pedida si el usuario la puede abrir; si no —o si no existe—, la primera que sí.
 *
 * Es un `canActivate` y no un `redirectTo` con función: los redirects se resuelven antes que los guards, y en un
 * F5 la sesión todavía no está hidratada; el `canActivate` del área, que corre antes, la hidrata.
 */
const directoryFolderGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const visible = visibleDirectoryFolders((permission) => auth.hasPermission(permission));
  const requested = route.paramMap.get('folder');

  if (isDirectoryFolderId(requested) && visible.some((folder) => folder.id === requested)) {
    return true;
  }
  return router.createUrlTree([
    visible.length > 0 ? directoryFolderRoute(visible[0].id) : PANEL_HOME_ROUTE,
  ]);
};

export const DIRECTORY_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [directoryFolderGuard],
    children: [],
  },
  {
    path: ':folder',
    component: DirectoryPage,
    canActivate: [directoryFolderGuard],
  },
];
