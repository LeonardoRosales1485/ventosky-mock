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

export interface LineSerialsDialogData {
  productName: string;
  /** Los números que llevó **esa** línea, ya ordenados por el backend. */
  serials: readonly string[];
}

/**
 * Las unidades que llevó una línea del traslado, cuando son demasiadas para la fila.
 *
 * Sólo lista números: es el mismo dato que la fila muestra suelto cuando son pocas, sin consultas
 * extra. **No dice dónde está cada unidad hoy** —si sigue en el destino o si ya se vendió— y no es
 * un olvido: eso es otra pregunta, la contesta la ficha del producto, y traerla acá convertiría un
 * diálogo de lectura en una consulta por unidad.
 *
 * El orden lo pone el backend, alfabético, y acá no se toca: quien recibe busca un número en la
 * lista para cotejarlo contra una caja.
 */
@Component({
  selector: 'app-line-serials-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    TranslatePipe,
  ],
  templateUrl: './line-serials-dialog.component.html',
  styleUrl: './line-serials-dialog.component.css',
})
export class LineSerialsDialogComponent {
  protected readonly data = inject<LineSerialsDialogData>(MAT_DIALOG_DATA);
}
