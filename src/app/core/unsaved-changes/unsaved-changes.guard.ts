import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmDialogService } from '../confirm/confirm-dialog.service';
import { HasUnsavedChanges } from './unsaved-changes.tracker';

/**
 * Pide confirmación antes de abandonar una pantalla con cambios sin guardar. Cubre todas las
 * salidas que pasan por el router —el botón Cancelar, el Volver del encabezado, el sidebar y el
 * Atrás del navegador—; de la recarga y el cierre de pestaña se ocupa el `beforeunload` que
 * registra `trackUnsavedChanges`.
 *
 * Sin cambios devuelve `true` sin abrir nada, así que salir de un formulario intacto no cuesta un
 * clic extra.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) {
    return true;
  }

  const confirmDialog = inject(ConfirmDialogService);
  const translate = inject(TranslateService);

  // `confirm()` emite una sola vez y mapea el backdrop y el ESC a `false`, que es justo lo que el
  // router espera de un `canDeactivate`.
  return confirmDialog.confirm({
    title: translate.instant('unsavedChanges.title'),
    message: translate.instant('unsavedChanges.message'),
    confirmLabel: translate.instant('unsavedChanges.leave'),
    cancelLabel: translate.instant('unsavedChanges.stay'),
    confirmColor: 'warn',
  });
};
