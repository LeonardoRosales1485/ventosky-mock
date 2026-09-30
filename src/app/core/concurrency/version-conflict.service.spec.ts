import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideTranslateService } from '@ngx-translate/core';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../notifications/toast.service';
import { VersionConflictChoice } from './version-conflict-dialog.component';
import { VersionConflictService } from './version-conflict.service';

interface Record {
  uuid: string;
  name: string;
  version?: number;
}

describe('VersionConflictService', () => {
  /** Qué elige el usuario en el diálogo de conflicto. */
  let choice: VersionConflictChoice;
  let opened: number;
  let toastError: ReturnType<typeof vi.fn>;
  let service: VersionConflictService;

  /** `Record` acá es el registro de prueba, así que el `data` del error se tipa a mano. */
  interface ConflictData {
    uuid?: string;
    sentVersion?: number;
    currentVersion?: number;
  }

  const conflict = (developerMessage: string, data?: ConflictData): HttpErrorResponse =>
    new HttpErrorResponse({
      status: 409,
      error: {
        status: 'CONFLICT',
        errorCode: 'VERSION_CONFLICT',
        developerMessage,
        userMessage: 'Registro desactualizado.',
        data,
      },
    });

  /** Un 409 de negocio: mismo status, otro `errorCode`, no se resuelve recargando. */
  const businessConflict = (errorCode: string): HttpErrorResponse =>
    new HttpErrorResponse({
      status: 409,
      error: { status: 'CONFLICT', errorCode, userMessage: 'La regla está en uso.' },
    });

  /** El 409 informa los argumentos del conflicto en `data`; la versión vigente sale de ahí. */
  const versionMismatch = (sent: number, current: number): HttpErrorResponse =>
    conflict(
      `Error en AbstractService.hookSaveValidateVersion: Brand uuid=b-1 version enviada=${sent}, version actual=${current}`,
      { uuid: 'b-1', sentVersion: sent, currentVersion: current },
    );

  beforeEach(() => {
    choice = 'reload';
    opened = 0;
    toastError = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        {
          provide: MatDialog,
          useValue: {
            open: () => {
              opened += 1;
              return { afterClosed: () => of(choice) };
            },
          },
        },
        { provide: ToastService, useValue: { error: toastError } },
      ],
    });

    service = TestBed.inject(VersionConflictService);
  });

  it('saves straight through and never asks when there is no conflict', async () => {
    const save = vi.fn((version: number | undefined) => of({ uuid: 'b-1', name: 'ACME', version }));

    const outcome = await firstValueFrom(
      service.saveGuarded<Record, Record>({
        uuid: 'b-1',
        version: 2,
        save,
        fetchLatest: () => of({ uuid: 'b-1', name: 'ACME', version: 2 }),
      }),
    );

    expect(save).toHaveBeenCalledWith(2);
    expect(opened).toBe(0);
    expect(outcome).toEqual({ kind: 'saved', value: { uuid: 'b-1', name: 'ACME', version: 2 } });
  });

  /**
   * El backend usa 409 para conflictos de negocio —faltante de stock, regla en uso, caja abierta—
   * que no se arreglan recargando. Ofrecer «sobrescribir» ahí taparía el mensaje que explica el
   * problema real, así que tienen que seguir llegando al `error` de cada pantalla.
   */
  it('lets a business 409 through untouched', async () => {
    const error = businessConflict('PRICE_RULE_LOCKED');

    await expect(
      firstValueFrom(
        service.saveGuarded<Record, Record>({
          uuid: 'b-1',
          version: 2,
          save: () => throwError(() => error),
          fetchLatest: () => of({ uuid: 'b-1', name: 'ACME', version: 9 }),
        }),
      ),
    ).rejects.toBe(error);

    expect(opened).toBe(0);
  });

  it('retries with the version the 409 reported when the user overwrites', async () => {
    choice = 'overwrite';
    const attempts: (number | undefined)[] = [];
    const fetchLatest = vi.fn(() => of({ uuid: 'b-1', name: 'ACME', version: 5 }));

    const save = vi.fn((version: number | undefined): Observable<Record> => {
      attempts.push(version);
      return version === 2
        ? throwError(() => versionMismatch(2, 5))
        : of({ uuid: 'b-1', name: 'ACME', version: 6 });
    });

    const outcome = await firstValueFrom(
      service.saveGuarded<Record, Record>({ uuid: 'b-1', version: 2, save, fetchLatest }),
    );

    expect(attempts).toEqual([2, 5]);
    // La versión vigente venía en el `data` del 409, así que sobrescribir no gasta una lectura extra.
    expect(fetchLatest).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'saved', value: { uuid: 'b-1', name: 'ACME', version: 6 } });
  });

  /**
   * Los dos caminos del backend informan la versión vigente, pero el de carrera real la relee de
   * base después del choque y puede no conseguirla. Cuando el 409 no la trae, se relee el registro.
   */
  it('reads the record to overwrite when the 409 does not carry the version', async () => {
    choice = 'overwrite';
    const attempts: (number | undefined)[] = [];
    const fetchLatest = vi.fn(() => of({ uuid: 'b-1', name: 'ACME', version: 7 }));

    const save = vi.fn((version: number | undefined): Observable<Record> => {
      attempts.push(version);
      return version === 2
        ? throwError(() =>
            conflict(
              'Error en AbstractService.saveOrCreate: conflicto de @Version en Brand uuid=b-1',
            ),
          )
        : of({ uuid: 'b-1', name: 'ACME', version: 8 });
    });

    await firstValueFrom(
      service.saveGuarded<Record, Record>({ uuid: 'b-1', version: 2, save, fetchLatest }),
    );

    expect(attempts).toEqual([2, 7]);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('returns the record the server has when the user reloads', async () => {
    choice = 'reload';
    const latest = { uuid: 'b-1', name: 'ACME S.A.', version: 5 };

    const outcome = await firstValueFrom(
      service.saveGuarded<Record, Record>({
        uuid: 'b-1',
        version: 2,
        save: () => throwError(() => versionMismatch(2, 5)),
        fetchLatest: () => of(latest),
      }),
    );

    expect(outcome).toEqual({ kind: 'reloaded', latest });
  });

  /**
   * Sin esto el `error` de la pantalla diría «no se pudo guardar» cuando lo que falló fue traer los
   * datos nuevos, que es un problema distinto y con otra salida.
   */
  it('reports a failed reload as its own problem instead of a failed save', async () => {
    choice = 'reload';

    const outcome = await firstValueFrom(
      service.saveGuarded<Record, Record>({
        uuid: 'b-1',
        version: 2,
        save: () => throwError(() => versionMismatch(2, 5)),
        fetchLatest: () => throwError(() => new HttpErrorResponse({ status: 503 })),
      }),
    );

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  /**
   * Pasa cuando la lectura que hidrata el formulario falló, o cuando el registro vino de un
   * endpoint que no devuelve los campos del Core. Guardar sin versión daría un 409 seguro y el
   * usuario vería un aviso falso de que otro lo modificó.
   */
  it('reads the version before saving when the form never got one', async () => {
    const save = vi.fn((version: number | undefined) => of({ uuid: 'b-1', name: 'ACME', version }));
    const fetchLatest = vi.fn(() => of({ uuid: 'b-1', name: 'ACME', version: 3 }));

    const outcome = await firstValueFrom(
      service.saveGuarded<Record, Record>({
        uuid: 'b-1',
        version: undefined,
        save,
        fetchLatest,
      }),
    );

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
    expect(opened).toBe(0);
    expect(outcome.kind).toBe('saved');
  });

  /** Un alta no tiene registro que releer, y el backend no valida versión sin `uuid`. */
  it('does not read anything when creating', async () => {
    const fetchLatest = vi.fn(() => of({ uuid: 'b-1', name: 'ACME', version: 3 }));

    await firstValueFrom(
      service.saveGuarded<Record, Record>({
        uuid: undefined,
        version: undefined,
        save: (version) => of({ uuid: 'b-1', name: 'ACME', version }),
        fetchLatest,
      }),
    );

    expect(fetchLatest).not.toHaveBeenCalled();
  });
});
