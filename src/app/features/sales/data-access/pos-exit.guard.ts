import { Signal, inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmDialogService } from '../../../core/confirm/confirm-dialog.service';

/**
 * Lo que {@link posExitGuard} le pide a la pantalla que protege. Tiene que ser público —no
 * `protected`— porque el guard lo lee desde afuera del componente.
 */
export interface HasPendingSale {
  /** Si hay una venta a medio armar que salir de la pantalla tiraría. */
  readonly hasPendingSale: Signal<boolean>;
}

/**
 * Pide confirmación antes de dejar el punto de venta con el carrito cargado.
 *
 * El carrito vive sólo en memoria —la venta se persiste entera recién en el commit, no hay
 * borradores—, así que salir con productos adentro no deja nada a lo que volver: hay que armarla de
 * nuevo, y en un mostrador eso es hacer esperar a alguien que está enfrente.
 *
 * Es un `canDeactivate` y no una pregunta del botón «Salir» para que cubra todas las salidas que
 * pasan por el router, el Atrás del navegador incluido; de la recarga y el cierre de pestaña se
 * ocupa el `beforeunload` que registra la pantalla.
 *
 * Con el carrito vacío devuelve `true` sin abrir nada: entrar al POS y salir sin vender no tiene por
 * qué costar un clic extra.
 */
export const posExitGuard: CanDeactivateFn<HasPendingSale> = (component) => {
  if (!component.hasPendingSale()) {
    return true;
  }

  const confirmDialog = inject(ConfirmDialogService);
  const translate = inject(TranslateService);

  return confirmDialog.confirm({
    title: translate.instant('sales.pos.exit.title'),
    message: translate.instant('sales.pos.exit.message'),
    confirmLabel: translate.instant('sales.pos.exit.leave'),
    cancelLabel: translate.instant('sales.pos.exit.stay'),
    confirmColor: 'warn',
  });
};
