import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchDto } from '../branch/branch.model';
import { BranchesApiService } from '../branch/branches-api.service';
import { ConfirmDialogService } from '../confirm/confirm-dialog.service';
import { TokenRefreshService } from '../http/token-refresh.service';
import { TOKEN_KEY } from '../local-storage/local-storage-keys.constants';
import {
  BRANCH_UUID_KEY,
  COMPANY_UUID_KEY,
} from '../tab-context/tab-context-keys.constants';
import { AuthApi } from './auth-api.service';
import { AuthService } from './auth.service';

const BRANCHES: BranchDto[] = [
  { uuid: 'centro', name: 'Sucursal Centro', active: true },
  { uuid: 'norte', name: 'Sucursal Norte', active: true },
];

/**
 * El cambio de sucursal recarga la aplicación entera, así que lo que se comprueba acá es cuándo
 * llega a recargar: la salida por el router es la que puede cancelarlo, y la sucursal no se
 * persiste hasta que esa salida está concedida.
 */
describe('AuthService.switchBranch', () => {
  let navigateByUrl: Mock<Router['navigateByUrl']>;
  let isActive: Mock<() => boolean>;
  let replace: Mock<(url: string) => void>;

  const createService = (): AuthService => {
    const service = TestBed.inject(AuthService);
    // El catálogo de sucursales lo puebla el guard al entrar al panel; acá, su misma llamada.
    service.ensureBranchContext().subscribe();
    return service;
  };

  beforeEach(() => {
    localStorage.setItem(COMPANY_UUID_KEY, 'empresa');
    localStorage.setItem(BRANCH_UUID_KEY, 'centro');

    navigateByUrl = vi.fn(() => Promise.resolve(true));
    isActive = vi.fn(() => false);
    replace = vi.fn();

    vi.stubGlobal('location', {
      href: 'https://erp.test/panel/products',
      replace,
    });

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthApi, useValue: {} },
        { provide: BranchesApiService, useValue: { listAvailable: () => of(BRANCHES) } },
        { provide: ConfirmDialogService, useValue: { confirm: () => of(true) } },
        {
          provide: TokenRefreshService,
          useValue: { tokensRotated$: EMPTY, sessionInvalidated$: EMPTY },
        },
      ],
    });

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockImplementation(navigateByUrl);
    vi.spyOn(router, 'isActive').mockImplementation(isActive);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('leaves the current screen through the router before reloading', async () => {
    createService().switchBranch('norte');
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());

    expect(navigateByUrl).toHaveBeenCalledWith('/panel', { replaceUrl: true });
    expect(localStorage.getItem(BRANCH_UUID_KEY)).toBe('norte');
    // Vuelve a la pantalla donde estaba el usuario, ya con la sucursal nueva.
    expect(replace).toHaveBeenCalledWith('https://erp.test/panel/products');
  });

  /** Es lo que hace `unsavedChangesGuard` cuando el usuario decide quedarse con sus cambios. */
  it('keeps the branch untouched when the exit is denied', async () => {
    navigateByUrl.mockResolvedValue(false);

    createService().switchBranch('norte');
    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalled());

    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(BRANCH_UUID_KEY)).toBe('centro');
  });

  /**
   * Estando en el panel no hay pantalla que abandonar. Navegar ahí sería una navegación a la misma
   * URL, que el router saltea resolviendo `false`: leído como una salida denegada, dejaría el
   * cambio de sucursal muerto justo en la pantalla de inicio.
   */
  it('reloads without navigating when already on the panel home', async () => {
    isActive.mockReturnValue(true);

    createService().switchBranch('norte');
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(localStorage.getItem(BRANCH_UUID_KEY)).toBe('norte');
  });

  it('does nothing for the branch already in use', () => {
    createService().switchBranch('centro');

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * La sucursal es de cada tab: la que eligió otro —y que por eso quedó en la semilla— no le mueve
   * el contexto a este, que ya fijó el suyo al arrancar.
   */
  it('ignores the branch another tab switched to', async () => {
    const service = createService();
    localStorage.setItem(BRANCH_UUID_KEY, 'norte');

    service.switchBranch('norte');
    await vi.waitFor(() => expect(replace).toHaveBeenCalled());

    expect(sessionStorage.getItem(BRANCH_UUID_KEY)).toBe('norte');
    expect(service.selectedBranchUuid()).toBe('norte');
  });

  it('does nothing for a branch outside the company', () => {
    createService().switchBranch('ajena');

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

/**
 * El token es lo único que sigue siendo de todo el navegador, así que cerrarlo en una solapa deja a
 * las demás sin credencial. Lo que se comprueba acá es que el aviso se lea bien: un cierre manda al
 * login, una rotación no.
 */
describe('AuthService cuando otro tab cierra la sesión', () => {
  let navigateByUrl: Mock<Router['navigateByUrl']>;

  const USER = { uuid: 'u-1', username: 'josue', userCompanyRoles: [] };

  /** Un tab con sesión abierta: el usuario en memoria es lo que lo distingue de uno en el login. */
  const createLoggedInService = (): AuthService => {
    localStorage.setItem(TOKEN_KEY, 'jwt');
    const service = TestBed.inject(AuthService);
    service.ensureAuthenticated().subscribe();
    return service;
  };

  /** El evento que el navegador le manda a los tabs que **no** hicieron el cambio. */
  const otherTabWrote = (key: string | null): void => {
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  };

  beforeEach(() => {
    navigateByUrl = vi.fn(() => Promise.resolve(true));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: AuthApi, useValue: { getMe: () => of(USER) } },
        { provide: BranchesApiService, useValue: { listAvailable: () => of(BRANCHES) } },
        { provide: ConfirmDialogService, useValue: { confirm: () => of(true) } },
        {
          provide: TokenRefreshService,
          useValue: { tokensRotated$: EMPTY, sessionInvalidated$: EMPTY },
        },
      ],
    });

    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(navigateByUrl);
  });

  it('manda el tab al login y le limpia la sesión', async () => {
    const service = createLoggedInService();

    localStorage.removeItem(TOKEN_KEY);
    otherTabWrote(TOKEN_KEY);

    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith('/auth/login'));
    await vi.waitFor(() => expect(service.isLoggedOut()).toBe(true));
  });

  /** Un `localStorage.clear()` se lleva el token sin nombrarlo: el evento llega con la clave nula. */
  it('también reacciona a un borrado completo del storage', async () => {
    createLoggedInService();

    localStorage.clear();
    otherTabWrote(null);

    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith('/auth/login'));
  });

  /** Refrescar el token en otro tab escribe la misma clave, y ahí no hay nada que cerrar. */
  it('no confunde una rotación del token con un cierre', () => {
    createLoggedInService();

    localStorage.setItem(TOKEN_KEY, 'jwt-rotado');
    otherTabWrote(TOKEN_KEY);

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('ignora los cambios de cualquier otra clave', () => {
    createLoggedInService();

    otherTabWrote(BRANCH_UUID_KEY);

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  /**
   * Es lo que hace `unsavedChangesGuard` cuando el usuario decide quedarse con sus cambios: no se
   * limpia nada, así el tab queda como habría quedado sin este aviso.
   */
  it('no limpia nada si el usuario prefiere quedarse', async () => {
    navigateByUrl.mockResolvedValue(false);
    const service = createLoggedInService();

    localStorage.removeItem(TOKEN_KEY);
    otherTabWrote(TOKEN_KEY);

    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalled());
    expect(service.isLoggedIn()).toBe(true);
  });
});
