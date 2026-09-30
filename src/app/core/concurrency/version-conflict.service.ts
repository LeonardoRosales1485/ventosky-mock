import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { ToastService } from '../notifications/toast.service';
import {
  VersionConflictChoice,
  VersionConflictDialogComponent,
  VersionConflictDialogData,
} from './version-conflict-dialog.component';
import { Versioned, isVersionConflict, readConflictCurrentVersion } from './version-conflict.model';

/** Un guardado que puede chocar con el bloqueo optimista, y con qué releer el registro. */
export interface GuardedSave<T, L extends Versioned = Versioned> {
  /**
   * Registro que se está editando. `undefined` en un alta: sin `uuid` el backend no valida
   * versión, así que ese guardado nunca puede chocar.
   */
  uuid: string | undefined;
  /** Versión que traía el registro cuando se abrió el formulario. `undefined` en un alta. */
  version: number | undefined;
  /** Reenvía el mismo payload editado con la versión indicada. */
  save: (version: number | undefined) => Observable<T>;
  /**
   * Relee el registro del servidor. Es lo que devuelve `reloaded`, y el respaldo para sobrescribir
   * cuando el 409 no informó la versión actual.
   */
  fetchLatest: (uuid: string) => Observable<L>;
  /** Nombre del registro, para que el diálogo diga cuál está en conflicto. */
  label?: string;
  /**
   * Ofrece «Cancelar». Sólo tiene sentido cuando el formulario sigue vivo detrás del diálogo, es
   * decir en las pantallas de edición con ruta propia. En los ABM el formulario es un diálogo que
   * ya se cerró al guardar, así que cancelar perdería lo tipeado sin decirlo.
   */
  allowCancel?: boolean;
}

/**
 * Cómo terminó el guardado. `reloaded` no es un error: el usuario eligió descartar lo suyo, y la
 * pantalla tiene que rehidratarse con `latest`. `cancelled` deja todo como estaba —el guardado no
 * entró y el formulario queda intacto— y también es lo que se devuelve cuando la recarga falla,
 * con el aviso ya mostrado.
 */
export type GuardedSaveOutcome<T, L> =
  { kind: 'saved'; value: T } | { kind: 'reloaded'; latest: L } | { kind: 'cancelled' };

/**
 * El 409 de bloqueo optimista es el único error de guardado que tiene salida sin perder lo tipeado,
 * así que se maneja acá y no en el `error` de cada pantalla: se le pregunta al usuario si quiere
 * sobrescribir —reenviar su payload con la versión que hoy tiene el registro— o recargar.
 *
 * Los demás 409 del backend (faltante de stock en una venta, regla de precio en uso, caja con
 * sesión abierta, lote finalizado) no pasan por acá: `isVersionConflict` los distingue por el
 * `errorCode` y siguen cayendo en el manejo de error de cada pantalla, que es donde se explican.
 */
@Service()
export class VersionConflictService {
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  /**
   * Guarda, y si el registro quedó desactualizado pregunta qué hacer. Sobrescribir reintenta con la
   * versión vigente —y vuelve a preguntar si en el medio alguien guardó otra vez—, así que el ciclo
   * sólo termina cuando el guardado entra, el usuario recarga, o cancela.
   */
  saveGuarded<T, L extends Versioned>(
    config: GuardedSave<T, L>,
  ): Observable<GuardedSaveOutcome<T, L>> {
    // Editar sin saber la versión termina siempre en 409, y el usuario vería un aviso falso de que
    // otro lo modificó. Pasa cuando la lectura que hidrata el formulario falló, o cuando el
    // registro viene de un endpoint que no devuelve los campos del Core: ahí se lee antes.
    if (config.uuid !== undefined && config.version === undefined) {
      const uuid = config.uuid;
      return config
        .fetchLatest(uuid)
        .pipe(switchMap((latest) => this.attempt(config, latest.version)));
    }

    return this.attempt(config, config.version);
  }

  /** Pregunta qué hacer con un 409 que la pantalla ya detectó por su cuenta. */
  ask(label?: string, allowCancel = false): Observable<VersionConflictChoice> {
    const data: VersionConflictDialogData = { label, allowCancel };

    return this.dialog
      .open<VersionConflictDialogComponent, VersionConflictDialogData, VersionConflictChoice>(
        VersionConflictDialogComponent,
        {
          width: '30rem',
          maxWidth: '95vw',
          // `first-tabbable` es lo único que respeta el `cdkFocusInitial` de la plantilla.
          autoFocus: 'first-tabbable',
          // Sin «Cancelar» no hay salida neutra: cerrar con Esc dejaría el guardado a medias y el
          // formulario ya cerrado, sin que el usuario haya decidido nada.
          disableClose: !allowCancel,
          data,
        },
      )
      .afterClosed()
      .pipe(map((choice) => choice ?? 'cancel'));
  }

  private attempt<T, L extends Versioned>(
    config: GuardedSave<T, L>,
    version: number | undefined,
  ): Observable<GuardedSaveOutcome<T, L>> {
    return config.save(version).pipe(
      map((value) => ({ kind: 'saved', value }) as GuardedSaveOutcome<T, L>),
      catchError((error: unknown) => {
        if (!isVersionConflict(error)) {
          return throwError(() => error);
        }

        // Un conflicto sin `uuid` sólo puede venir del upsert por clave natural, donde no hay
        // registro que releer ni versión que reenviar: se trata como cualquier otro error.
        const uuid = config.uuid;
        if (uuid === undefined) {
          return throwError(() => error);
        }

        return this.ask(config.label, config.allowCancel ?? false).pipe(
          switchMap((choice) => {
            if (choice === 'overwrite') {
              return this.currentVersion(error, config, uuid).pipe(
                switchMap((current) =>
                  current === null
                    ? this.giveUp<T, L>('versionUnavailable')
                    : this.attempt(config, current),
                ),
              );
            }

            if (choice === 'reload') {
              return config.fetchLatest(uuid).pipe(
                map((latest) => ({ kind: 'reloaded', latest }) as GuardedSaveOutcome<T, L>),
                catchError(() => this.giveUp<T, L>('reloadError')),
              );
            }

            return of({ kind: 'cancelled' } as GuardedSaveOutcome<T, L>);
          }),
        );
      }),
    );
  }

  /**
   * Versión con la que reintentar. El 409 la informa en `data.currentVersion` —los dos caminos del
   * backend, el rechazo previo al guardado y la carrera detectada en el flush—, así que sobrescribir
   * no gasta una lectura extra.
   *
   * Se relee el registro sólo cuando el error no la trajo: el camino de carrera la busca en base
   * después del choque y puede no encontrarla si el registro fue borrado.
   *
   * `null` cuando ninguno de los dos caminos la pudo conseguir.
   */
  private currentVersion<T, L extends Versioned>(
    error: unknown,
    config: GuardedSave<T, L>,
    uuid: string,
  ): Observable<number | null | undefined> {
    const fromError = readConflictCurrentVersion(error);
    if (fromError !== null) {
      return of(fromError);
    }

    return config.fetchLatest(uuid).pipe(
      map((latest) => latest.version),
      catchError(() => of(null)),
    );
  }

  /**
   * Cortar sin guardar ni recargar, avisando por qué. Es distinto de que falle el guardado: el
   * `error` de la pantalla diría «no se pudo guardar» cuando lo que falló fue la recarga.
   */
  private giveUp<T, L>(messageKey: string): Observable<GuardedSaveOutcome<T, L>> {
    this.toast.error(this.translate.instant(`versionConflict.${messageKey}`));
    return of({ kind: 'cancelled' } as GuardedSaveOutcome<T, L>);
  }
}
