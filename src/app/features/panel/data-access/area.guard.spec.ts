import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  GuardResult,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, firstValueFrom, isObservable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { Permissions } from '../../../core/auth/permissions';
import { areaGuard } from './area.guard';
import { PanelArea } from './panel-areas';

describe('areaGuard', () => {
  let permissions: Set<string>;
  let ensureAuthenticated: () => Observable<boolean>;

  const AREA: PanelArea = {
    path: 'products',
    section: 'catalog',
    icon: 'inventory_2',
    labelKey: 'nav.items.products',
    permission: Permissions.productBranchAssign,
    loadChildren: () => Promise.resolve([]),
  };

  /** Corre el guard como lo haría el router y resuelve su respuesta. */
  const run = async (area: PanelArea): Promise<GuardResult> => {
    const result = TestBed.runInInjectionContext(() =>
      areaGuard(area)({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    return isObservable(result) ? firstValueFrom(result) : await result;
  };

  beforeEach(() => {
    permissions = new Set<string>([Permissions.productBranchAssign]);
    ensureAuthenticated = () => of(true);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            ensureAuthenticated: () => ensureAuthenticated(),
            hasPermission: (permission: string) => permissions.has(permission),
          },
        },
      ],
    });
  });

  it('opens the area when the user holds its permission', async () => {
    expect(await run(AREA)).toBe(true);
  });

  it('sends the user home when the permission is missing', async () => {
    permissions.clear();

    const result = await run(AREA);

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/panel');
  });

  it('does not wait on the session for an area that needs no permission', async () => {
    const spy = vi.fn(() => of(true));
    ensureAuthenticated = spy;

    expect(await run({ ...AREA, path: 'home', permission: undefined })).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('closes an area switched off by a feature flag even if the user holds every permission', async () => {
    const result = await run({ ...AREA, enabled: false });

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toBe('/panel');
  });
});
