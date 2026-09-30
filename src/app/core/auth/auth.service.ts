import { computed, DestroyRef, inject, Service, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, finalize, map, Observable, of, switchMap, tap } from 'rxjs';
import { ConfirmDialogService } from '../confirm/confirm-dialog.service';
import { TokenRefreshService } from '../http/token-refresh.service';
import { LocalStorageService } from '../local-storage/local-storage.service';
import { TOKEN_KEY } from '../local-storage/local-storage-keys.constants';
import { TabContextStore } from '../tab-context/tab-context.store';
import { TranslateService } from '@ngx-translate/core';
import { BranchesApiService } from '../branch/branches-api.service';
import { BRANCH_CREATE_PERMISSION, BranchDto } from '../branch/branch.model';
import { AuthApi } from './auth-api.service';
import {
  AuthUser,
  AuthUserCompanyRole,
  AuthUserDto,
  LoginPayload,
  LogoutOptions,
  SYSTEM_COMPANY_UUID,
} from './auth.models';
import {
  LOGIN_ROUTE,
  PANEL_HOME_ROUTE,
  SELECT_BRANCH_ROUTE,
  SELECT_COMPANY_ROUTE,
} from './auth.paths';

/** Result of resolving branch context for guards / post-login navigation. */
export type BranchContextResult = 'ok' | 'select';

@Service()
export class AuthService {
  private readonly router = inject(Router);
  private readonly authApi = inject(AuthApi);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly tabContext = inject(TabContextStore);
  private readonly translate = inject(TranslateService);
  private readonly tokenRefresh = inject(TokenRefreshService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _authUser = signal<AuthUserDto | null>(null);
  private readonly _authToken = signal<string | null>(null);
  private readonly _authRefreshToken = signal<string | null>(null);
  private readonly _selectedCompanyUuid = signal<string | null>(null);
  private readonly _selectedBranchUuid = signal<string | null>(null);
  private readonly _availableBranches = signal<BranchDto[] | null>(null);

  public readonly isLoggedIn = computed(() => this._authUser() !== null);
  public readonly isLoggedOut = computed(() => this._authUser() === null);
  public readonly authToken = this._authToken.asReadonly();
  public readonly authRefreshToken = this._authRefreshToken.asReadonly();
  public readonly authUser = this._authUser.asReadonly();
  public readonly selectedCompanyUuid = this._selectedCompanyUuid.asReadonly();
  public readonly selectedBranchUuid = this._selectedBranchUuid.asReadonly();
  public readonly availableBranches = this._availableBranches.asReadonly();
  public readonly companies = computed<AuthUserCompanyRole[]>(
    () => this._authUser()?.userCompanyRoles ?? [],
  );
  public readonly selectedBranch = computed(() => {
    const uuid = this._selectedBranchUuid();
    const branches = this._availableBranches();
    if (!uuid || !branches) {
      return null;
    }
    return branches.find((branch) => branch.uuid === uuid) ?? null;
  });

  constructor() {
    this.hydrateFromStorage();
    this.watchRemoteLogout();

    this.tokenRefresh.tokensRotated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ token, refresh }) => {
        this._authToken.set(token);
        this._authRefreshToken.set(refresh);
      });

    this.tokenRefresh.sessionInvalidated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.clearSessionState();
      });
  }

  /**
   * Ensures the current session is valid for protected routes.
   * Reuses an in-memory user when present; otherwise restores from storage via `/me`.
   */
  public ensureAuthenticated(): Observable<boolean> {
    if (this._authUser()) {
      this.syncSelectedCompanyWithUser();
      return of(true);
    }

    const token = this.localStorageService.getToken();
    if (!token) {
      return of(false);
    }

    this.hydrateFromStorage();

    return this.authApi.getMe().pipe(
      tap((user) => {
        this._authUser.set(user);
        this.syncSelectedCompanyWithUser();
      }),
      map(() => true),
      catchError(() => {
        this.clearSession();
        return of(false);
      }),
    );
  }

  public needsCompanySelection(): boolean {
    const companies = this.companies();
    if (companies.length <= 1) {
      return false;
    }

    return !this.hasValidSelectedCompany();
  }

  public hasValidSelectedCompany(): boolean {
    const selected = this._selectedCompanyUuid();
    if (!selected) {
      return false;
    }

    return this.companies().some((company) => company.companyUuid === selected);
  }

  public hasValidSelectedBranch(): boolean {
    const selected = this._selectedBranchUuid();
    const branches = this._availableBranches();
    if (!selected || !branches) {
      return false;
    }

    return branches.some((branch) => branch.uuid === selected);
  }

  public hasPermission(permission: string): boolean {
    const dto = this._authUser();
    const companyUuid = this._selectedCompanyUuid();
    if (!dto || !companyUuid) {
      return false;
    }

    const user = new AuthUser(dto);
    return (
      user.hasPermissionByCompanyUuid(companyUuid, permission) ||
      user.hasPermissionByCompanyUuid(SYSTEM_COMPANY_UUID, permission)
    );
  }

  /**
   * Espeja el `isSysAdmin()` del backend: alcanza con pertenecer a la empresa sistema. Sirve para no
   * ofrecer acciones que la API reserva —marcar la lista de precios principal, por ejemplo—; la
   * autorización real la sigue aplicando el servidor.
   */
  public isSysAdmin(): boolean {
    const dto = this._authUser();
    return dto !== null && new AuthUser(dto).isSysAdmin();
  }

  public canCreateBranch(): boolean {
    return this.hasPermission(BRANCH_CREATE_PERMISSION);
  }

  public selectCompany(companyUuid: string): boolean {
    if (!this.companies().some((company) => company.companyUuid === companyUuid)) {
      return false;
    }

    const companyChanged = this._selectedCompanyUuid() !== companyUuid;
    this.persistSelectedCompany(companyUuid);
    if (companyChanged) {
      this.clearSelectedBranch();
      this._availableBranches.set(null);
    }
    this.resolvePostCompanyNavigation();
    return true;
  }

  public selectBranch(branchUuid: string): boolean {
    const branches = this._availableBranches();
    if (!branches?.some((branch) => branch.uuid === branchUuid)) {
      return false;
    }

    this.persistSelectedBranch(branchUuid);
    void this.router.navigateByUrl(PANEL_HOME_ROUTE);
    return true;
  }

  /**
   * Cambia de sucursal desde adentro del panel, recargando la aplicación entera.
   *
   * La sucursal viaja en `X-Branch-Uuid` y decide qué responde casi toda la API, así que cambiarla en
   * caliente dejaría viva la sucursal anterior en todo lo que ya está en memoria: la grilla que se
   * está mirando, un carrito armado, un formulario a medio llenar. La recarga es lo que garantiza
   * que no sobreviva nada de la sesión previa.
   *
   * Antes de recargar se sale por el router, que es lo que hace correr `unsavedChangesGuard`: así un
   * formulario con cambios pregunta con el diálogo de la app y puede cancelar el cambio, en vez de
   * toparse con el aviso del navegador cuando la sucursal ya está persistida. Concedida la salida,
   * se persiste y se vuelve —ya recargado— a la pantalla donde estaba el usuario.
   *
   * El cambio es de este tab y nada más: la sucursal nueva queda en su contexto (`TabContextStore`),
   * que sobrevive la recarga, y los demás tabs siguen operando cada uno en la suya.
   */
  public switchBranch(branchUuid: string): void {
    const branches = this._availableBranches();
    if (
      branchUuid === this._selectedBranchUuid() ||
      !branches?.some((branch) => branch.uuid === branchUuid)
    ) {
      return;
    }

    // La URL del navegador y no `router.url`: es la que hay que reponer tal cual, con su base href.
    const returnUrl = window.location.href;

    // Parado en el panel no hay pantalla que abandonar, y navegar ahí sería una navegación a la
    // misma URL: el router la saltea y la resuelve `false`, que acá se leería como un guard que
    // frenó la salida.
    const leaving = this.isPanelHome()
      ? Promise.resolve(true)
      : this.router.navigateByUrl(PANEL_HOME_ROUTE, { replaceUrl: true });

    void leaving.then((left) => {
      if (!left) {
        return; // El usuario prefirió quedarse con sus cambios sin guardar.
      }

      this.persistSelectedBranch(branchUuid);
      // `replace` y no `assign`: la entrada que se pisa es la del panel que acaba de crear la salida,
      // así que el historial queda como si el usuario nunca hubiese pasado por ahí.
      window.location.replace(returnUrl);
    });
  }

  private isPanelHome(): boolean {
    return this.router.isActive(PANEL_HOME_ROUTE, {
      paths: 'exact',
      queryParams: 'exact',
      fragment: 'ignored',
      matrixParams: 'ignored',
    });
  }

  /** After creating a branch, refresh the list, persist it, and enter the panel. */
  public selectCreatedBranch(branch: BranchDto): void {
    const current = this._availableBranches() ?? [];
    this._availableBranches.set([...current, branch]);
    this.persistSelectedBranch(branch.uuid);
    void this.router.navigateByUrl(PANEL_HOME_ROUTE);
  }

  public resolvePostLoginNavigation(): void {
    const companies = this.companies();

    if (companies.length === 0) {
      this.clearSelectedCompany();
      this.clearSelectedBranch();
      void this.router.navigateByUrl(PANEL_HOME_ROUTE);
      return;
    }

    if (companies.length === 1) {
      this.persistSelectedCompany(companies[0].companyUuid);
      this.resolvePostCompanyNavigation();
      return;
    }

    if (this.hasValidSelectedCompany()) {
      this.resolvePostCompanyNavigation();
      return;
    }

    this.clearSelectedCompany();
    this.clearSelectedBranch();
    void this.router.navigateByUrl(SELECT_COMPANY_ROUTE);
  }

  /**
   * Loads branches for the selected company and decides whether to enter the panel
   * or show the branch selection screen. Uses a stored `branchUuid` when still valid.
   */
  public resolvePostCompanyNavigation(): void {
    this.ensureBranchContext().subscribe((result) => {
      if (result === 'select') {
        void this.router.navigateByUrl(SELECT_BRANCH_ROUTE);
        return;
      }
      void this.router.navigateByUrl(PANEL_HOME_ROUTE);
    });
  }

  /**
   * Ensures branch context for the selected company.
   * - 0 companies / no company → skip branch
   * - 0 branches → selection screen (create if permitted)
   * - 1 branch → auto-persist and continue
   * - 2+ branches → reuse stored uuid when valid, otherwise selection screen
   */
  public ensureBranchContext(): Observable<BranchContextResult> {
    if (!this._selectedCompanyUuid()) {
      this.clearSelectedBranch();
      this._availableBranches.set([]);
      return of('ok');
    }

    return this.loadBranches().pipe(
      map((branches) => this.resolveBranchSelection(branches)),
      catchError(() => {
        this._availableBranches.set([]);
        if (this.canCreateBranch()) {
          this.clearSelectedBranch();
          return of('select' as const);
        }
        this.clearSelectedBranch();
        return of('ok' as const);
      }),
    );
  }

  public login(
    request: LoginPayload,
  ): Observable<{ token: string; user: AuthUserDto; refresh: string }> {
    return this.authApi.login(request).pipe(
      switchMap(({ token, refresh }) => {
        this.persistTokens(token, refresh);

        return this.authApi.getMe().pipe(
          map((user) => ({
            token,
            refresh,
            user,
          })),
        );
      }),
      tap(({ user }) => {
        this._authUser.set(user);
        this.resolvePostLoginNavigation();
      }),
    );
  }

  /** Rotates the access token; delegates to `TokenRefreshService`. */
  public refreshSession(): Observable<string> {
    return this.tokenRefresh.refresh();
  }

  public clearSession(): void {
    this.localStorageService.removeToken();
    this.localStorageService.removeRefreshToken();
    this.tabContext.clear();
    this.clearSessionState();
  }

  public logout({ requireConfirmation = false }: LogoutOptions): void {
    const logout = () => {
      this.authApi
        .logout()
        .pipe(
          tap(() => this.clearSession()),
          finalize(() => {
            void this.router.navigateByUrl(LOGIN_ROUTE);
          }),
        )
        .subscribe();
    };

    if (requireConfirmation) {
      this.confirm
        .confirm({
          title: this.translate.instant('auth.logout.title'),
          message: this.translate.instant('auth.logout.message'),
          confirmLabel: this.translate.instant('auth.logout.confirm'),
        })
        .subscribe((result) => {
          if (result) {
            logout();
          }
        });
    } else {
      logout();
    }
  }

  /**
   * Las sucursales entre las que se elige: las disponibles para cualquier miembro, no el paginado de
   * la pantalla de sucursales. Con el paginado, quien no tenía `branch.view` —un cliente, un vendedor—
   * entraba al panel sin sucursal y toda lectura acotada respondía 400.
   */
  private loadBranches(): Observable<BranchDto[]> {
    return this.branchesApi.listAvailable().pipe(
      tap((branches) => {
        this._availableBranches.set(branches);
      }),
    );
  }

  private resolveBranchSelection(branches: BranchDto[]): BranchContextResult {
    if (branches.length === 0) {
      this.clearSelectedBranch();
      return 'select';
    }

    if (branches.length === 1) {
      this.persistSelectedBranch(branches[0].uuid);
      return 'ok';
    }

    if (this.hasValidSelectedBranch()) {
      return 'ok';
    }

    this.clearSelectedBranch();
    return 'select';
  }

  private clearSessionState(): void {
    this._authUser.set(null);
    this._authToken.set(null);
    this._authRefreshToken.set(null);
    this._selectedCompanyUuid.set(null);
    this._selectedBranchUuid.set(null);
    this._availableBranches.set(null);
  }

  private persistTokens(token: string, refresh: string): void {
    this.localStorageService.setToken(token);
    this.localStorageService.setRefreshToken(refresh);
    this._authToken.set(token);
    this._authRefreshToken.set(refresh);
  }

  /**
   * Cierra la sesión de este tab cuando la cerraron desde otro.
   *
   * El token es lo único que sigue siendo de todo el navegador —los tabs comparten el usuario, no la
   * sucursal—, así que cerrar sesión en una solapa deja a las demás sin credencial. El evento
   * `storage` llega sólo a los tabs que no lo provocaron, que es justo el aviso que hace falta.
   *
   * Sin esto el tab no se entera por su cuenta: sus requests salen sin `Authorization`, y el 401 que
   * vuelve no es `ACCESS_TOKEN_EXPIRED`, el único que `authErrorInterceptor` reintenta. Nadie
   * refresca ni redirige, y el usuario se queda mirando errores en una pantalla que ya no puede
   * usar. Con varias solapas abiertas a la vez —cada una en su sucursal— dejó de ser un caso raro.
   *
   * Se sale por el router y recién ahí se limpia, así que un formulario con cambios pregunta antes;
   * si el usuario prefiere quedarse no se toca nada, y el tab queda como habría quedado sin esto.
   */
  private watchRemoteLogout(): void {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) {
        return;
      }

      // Una `key` en `null` es un `clear()` de todo el storage, que se lleva el token con él.
      if (event.key !== null && event.key !== TOKEN_KEY) {
        return;
      }

      // Sin usuario en memoria no hay sesión que cerrar. Y si el token sigue guardado, lo que pasó
      // fue un login o una rotación en otro tab, no un cierre.
      if (this._authUser() === null || this.localStorageService.getToken() !== null) {
        return;
      }

      void this.router.navigateByUrl(LOGIN_ROUTE).then((left) => {
        if (left) {
          this.clearSession();
        }
      });
    };

    window.addEventListener('storage', onStorage);
    this.destroyRef.onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  private hydrateFromStorage(): void {
    this._authToken.set(this.localStorageService.getToken());
    this._authRefreshToken.set(this.localStorageService.getRefreshToken());
    this._selectedCompanyUuid.set(this.tabContext.getCompanyUuid());
    this._selectedBranchUuid.set(this.tabContext.getBranchUuid());
  }

  private syncSelectedCompanyWithUser(): void {
    const companies = this.companies();

    if (companies.length === 0) {
      this.clearSelectedCompany();
      this.clearSelectedBranch();
      return;
    }

    if (companies.length === 1) {
      this.persistSelectedCompany(companies[0].companyUuid);
      return;
    }

    if (!this.hasValidSelectedCompany()) {
      this.clearSelectedCompany();
      this.clearSelectedBranch();
    }
  }

  private persistSelectedCompany(companyUuid: string): void {
    this.tabContext.setCompanyUuid(companyUuid);
    this._selectedCompanyUuid.set(companyUuid);
  }

  private clearSelectedCompany(): void {
    this.tabContext.removeCompanyUuid();
    this._selectedCompanyUuid.set(null);
  }

  private persistSelectedBranch(branchUuid: string): void {
    this.tabContext.setBranchUuid(branchUuid);
    this._selectedBranchUuid.set(branchUuid);
  }

  private clearSelectedBranch(): void {
    this.tabContext.removeBranchUuid();
    this._selectedBranchUuid.set(null);
  }
}
