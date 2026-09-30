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
import { ConfirmDialogOptions } from '../confirm/confirm-dialog.model';
import { ConfirmDialogService } from '../confirm/confirm-dialog.service';
import { unsavedChangesGuard } from './unsaved-changes.guard';
import { HasUnsavedChanges } from './unsaved-changes.tracker';

describe('unsavedChangesGuard', () => {
  let confirm: Mock<(options: ConfirmDialogOptions) => Observable<boolean>>;

  /** Corre el guard como lo haría el router y resuelve su respuesta. */
  const run = async (hasUnsavedChanges: boolean): Promise<GuardResult> => {
    const component: HasUnsavedChanges = { hasUnsavedChanges: signal(hasUnsavedChanges) };

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(
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

  it('lets the user out without asking when nothing changed', async () => {
    expect(await run(false)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('leaves the screen when the user confirms losing the changes', async () => {
    expect(await run(true)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('keeps the user on the screen when the dialog is dismissed', async () => {
    confirm = vi.fn(() => of(false));

    expect(await run(true)).toBe(false);
  });
});
