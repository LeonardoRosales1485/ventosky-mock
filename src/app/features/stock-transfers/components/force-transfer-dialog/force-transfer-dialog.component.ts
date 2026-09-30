import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/** Una línea que el depósito de origen no puede cubrir, tal como se la muestra al operador. */
export interface ForceTransferShortage {
  productName: string;
  /** Lo que hay en el depósito de origen. */
  available: number;
  /** Lo que el traslado mueve. */
  requested: number;
}

export interface ForceTransferDialogData {
  sourceWarehouseName: string;
  branchName: string;
  shortages: readonly ForceTransferShortage[];
  /** El mensaje del backend, cuando el 412 lo trae. Es la razón que dio él, no la que supone el front. */
  apiMessage?: string | null;
}

/**
 * La confirmación de un traslado que deja el depósito de origen en negativo.
 *
 * **No la abre el front por su cuenta**: la abre el `412` del backend. La política de stock de la
 * sucursal es la que decide si el faltante bloquea (`STRICT_BLOCK`), pregunta
 * (`WARNING_CONFIRMATION`) o pasa derecho (`FORCE_SALE`), y adivinarla acá haría que la pantalla
 * pidiera confirmaciones que el backend no pide, o peor, que no pidiera las que sí.
 *
 * Aceptar reenvía el mismo request con `forceTransfer: true`. El resto de las líneas se despachan
 * igual: el faltante es de una línea, no del traslado.
 */
@Component({
  selector: 'app-force-transfer-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    TranslatePipe,
  ],
  templateUrl: './force-transfer-dialog.component.html',
  styleUrl: './force-transfer-dialog.component.css',
})
export class ForceTransferDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ForceTransferDialogComponent, boolean>);

  protected readonly data = inject<ForceTransferDialogData>(MAT_DIALOG_DATA);

  /** El saldo en el que queda el depósito. Es negativo: es exactamente lo que se está confirmando. */
  protected resultingBalance(shortage: ForceTransferShortage): number {
    return shortage.available - shortage.requested;
  }

  protected onConfirm(): void {
    this.dialogRef.close(true);
  }
}
