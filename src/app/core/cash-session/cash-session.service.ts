import { HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { resolveApiErrorMessage } from '../http/api-error.model';
import { ToastService } from '../notifications/toast.service';
import { CashRegisterDto, CashSessionDto } from './cash-session.model';
import { CashSessionApiService } from './cash-session-api.service';
import {
  OpenCashSessionDialogComponent,
  OpenCashSessionDialogData,
  OpenCashSessionDialogResult,
} from './open-cash-session-dialog/open-cash-session-dialog.component';

/**
 * Cómo terminó el intento de apertura.
 *
 * `alreadyOpen` se distingue del resto porque tiene una salida distinta: no es algo para reintentar
 * sino una caja que quedó desactualizada en pantalla, y quien la mostró tiene que releerla.
 */
export type OpenCashSessionOutcome =
  { kind: 'opened'; session: CashSessionDto } | { kind: 'alreadyOpen' } | { kind: 'none' };

/**
 * Apertura de la sesión de caja, de punta a punta: pide el monto inicial, llama al backend y avisa
 * cómo salió.
 *
 * Está en `core/` y no en una pantalla porque la ofrecen tres —el mostrador de ventas, el alta de
 * compras y el ABM de cajas—, y en las tres la interacción es la misma. Lo que cambia es qué hace
 * cada una después, así que el resultado se devuelve en vez de resolverlo acá.
 */
@Service()
export class CashSessionService {
  private readonly dialog = inject(MatDialog);
  private readonly api = inject(CashSessionApiService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  /** Pide el monto inicial y abre la caja. Cancelar el diálogo devuelve `none` sin llamar a la API. */
  open(cashRegister: CashRegisterDto): Observable<OpenCashSessionOutcome> {
    const data: OpenCashSessionDialogData = { cashRegisterName: cashRegister.name };

    return this.dialog
      .open<OpenCashSessionDialogComponent, OpenCashSessionDialogData, OpenCashSessionDialogResult>(
        OpenCashSessionDialogComponent,
        { width: '26rem', maxWidth: '95vw', autoFocus: 'dialog', data },
      )
      .afterClosed()
      .pipe(
        switchMap((result) =>
          result
            ? this.commit(cashRegister, result.openingAmount)
            : of<OpenCashSessionOutcome>({ kind: 'none' }),
        ),
      );
  }

  private commit(
    cashRegister: CashRegisterDto,
    openingAmount: number,
  ): Observable<OpenCashSessionOutcome> {
    return this.api.open(cashRegister.uuid, openingAmount).pipe(
      map((session): OpenCashSessionOutcome => {
        this.toast.success(
          this.translate.instant('cashSession.open.success', { name: cashRegister.name }),
        );
        return { kind: 'opened', session };
      }),
      catchError((error: unknown) => {
        // El 409 llega con su propio mensaje («esta caja ya tiene una sesión abierta»), que explica
        // mejor la situación que cualquier texto propio: se muestra ese.
        this.toast.error(
          resolveApiErrorMessage(error, this.translate.instant('cashSession.open.error')),
        );

        const alreadyOpen = error instanceof HttpErrorResponse && error.status === 409;
        return of<OpenCashSessionOutcome>(alreadyOpen ? { kind: 'alreadyOpen' } : { kind: 'none' });
      }),
    );
  }
}
