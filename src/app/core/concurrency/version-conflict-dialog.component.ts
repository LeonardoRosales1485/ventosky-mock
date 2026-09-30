import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

export interface VersionConflictDialogData {
  /** Nombre del registro en conflicto, cuando la pantalla lo tiene a mano. */
  label?: string;
  /**
   * Habilita «Cancelar», que deja el guardado sin hacer y devuelve al usuario a lo que estaba
   * editando. Sólo es honesto donde el formulario sigue vivo detrás del diálogo —las pantallas de
   * alta/edición con ruta propia—; en los ABM el formulario es un diálogo que ya se cerró, así que
   * ahí la decisión no tiene tercera salida y el diálogo no se puede descartar.
   */
  allowCancel: boolean;
}

/**
 * Qué hacer con el registro desactualizado: pisar los cambios del otro usuario con los propios,
 * descartar lo editado y traer lo último, o volver al formulario sin guardar ni recargar.
 */
export type VersionConflictChoice = 'overwrite' | 'reload' | 'cancel';

/**
 * La salida del 409 de bloqueo optimista: otro usuario guardó el registro mientras éste lo editaba.
 *
 * Las dos opciones pierden algo y por eso ninguna se aplica sola: sobrescribir pisa el trabajo
 * ajeno y recargar descarta el propio. `Recargar` queda como acción destacada y con el foco inicial
 * porque es la que no destruye datos de otra persona; `Sobrescribir` va en `warn` para que se lea
 * como lo que es.
 *
 * El texto sale siempre de las traducciones y no del `userMessage` del 409: el backend lo escribe
 * en castellano, así que mostrarlo dejaría el párrafo central en otro idioma que el resto del
 * diálogo. Dice lo mismo que `versionConflict.message`, y el nombre del registro —que el backend no
 * manda— lo pone la pantalla en `label`.
 */
@Component({
  selector: 'app-version-conflict-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    TranslatePipe,
  ],
  templateUrl: './version-conflict-dialog.component.html',
  styleUrl: './version-conflict-dialog.component.css',
})
export class VersionConflictDialogComponent {
  protected readonly data = inject<VersionConflictDialogData>(MAT_DIALOG_DATA);
}
