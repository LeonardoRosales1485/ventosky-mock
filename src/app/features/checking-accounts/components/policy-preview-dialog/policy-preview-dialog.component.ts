import { Component, computed, inject } from '@angular/core';
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
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PolicyPreviewDto } from '../../data-access/checking-account-policy.model';

export interface PolicyPreviewDialogData {
  preview: PolicyPreviewDto;
}

/** `true` = guardar y reprocesar. Cerrar sin confirmar vuelve a editar. */
export type PolicyPreviewDialogResult = boolean;

/**
 * Qué pasaría si se guardara esta política. **No escribe nada.**
 *
 * **Los dos bloques viajan juntos** porque quien configura toma una sola decisión —guardar o no— y
 * necesita los dos para tomarla: el reproceso que dispara pasar a automático, y las cuentas que
 * quedarían por encima del límite nuevo.
 *
 * **«3 de 412» y no «3»**: sin el denominador no se sabe si el reparto tocó casi todo o casi nada.
 *
 * **El bloque de reproceso desaparece cuando el guardado no es una transición de manual a
 * automático** — que es distinto de «no imputaría nada»: el camino inverso no reprocesa, porque
 * pasar a manual rige para los créditos nuevos.
 *
 * **Las cuentas por encima del límite no bloquean nada.** El límite gobierna operaciones nuevas y no
 * reescribe el pasado: esas cuentas siguen como están, pero desde mañana el mostrador les va a
 * rebotar ventas que hoy entraban, y enterarse después es lo que este diálogo evita.
 */
@Component({
  selector: 'app-policy-preview-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    TranslatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './policy-preview-dialog.component.html',
  styleUrl: './policy-preview-dialog.component.css',
})
export class PolicyPreviewDialogComponent {
  protected readonly data = inject<PolicyPreviewDialogData>(MAT_DIALOG_DATA);

  protected readonly reprocess = computed(() => this.data.preview.reprocess);

  /** Sin reproceso y sin cuentas excedidas, el guardado no tiene consecuencias que anunciar. */
  protected readonly harmless = computed(
    () => !this.data.preview.reprocess && this.data.preview.accountsOverLimit === 0,
  );
}
