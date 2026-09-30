import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  GuardResult,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { Observable, firstValueFrom, isObservable, of } from 'rxjs';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogOptions } from '../../../core/confirm/confirm-dialog.model';
import { ConfirmDialogService } from '../../../core/confirm/confirm-dialog.service';
import { HasPendingSale, posExitGuard } from './pos-exit.guard';

describe('posExitGuard', () => {
  let confirm: Mock<(options: ConfirmDialogOptions) => Observable<boolean>>;

  /** Corre el guard como lo haría el router y resuelve su respuesta. */
  const run = async (hasPendingSale: boolean): Promise<GuardResult> => {
    const component: HasPendingSale = { hasPendingSale: signal(hasPendingSale) };

    const result = TestBed.runInInjectionContext(() =>
      posExitGuard(
        component,
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot,
      ),
    );

    return isObservable(result) ? firstValueFrom(result) : await result;
  };

  beforeEach(() => {
    confirm = vi.fn(() => of(true));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        {
          provide: ConfirmDialogService,
          useValue: { confirm: (options: ConfirmDialogOptions) => confirm(options) },
        },
      ],
    });
  });

  it('deja salir sin preguntar cuando el carrito está vacío', async () => {
    expect(await run(false)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('deja salir cuando el usuario acepta perder la venta a medio armar', async () => {
    expect(await run(true)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('mantiene la venta en pantalla cuando el usuario cancela la salida', async () => {
    confirm = vi.fn(() => of(false));

    expect(await run(true)).toBe(false);
  });
});
