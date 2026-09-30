import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { ProductPickerDialogComponent } from './product-picker-dialog.component';
import {
  PickerProduct,
  ProductPickerDialogData,
  ProductPickerOptions,
} from './product-picker.model';

/**
 * Abre el selector de productos. Es la única puerta de entrada al diálogo: quien lo necesita pide
 * un producto y recibe la fila del paginado operativo, sin saber cómo se buscó.
 */
@Service()
export class ProductPickerService {
  private readonly dialog = inject(MatDialog);

  /** El producto elegido, o `null` si se cerró sin elegir. */
  pick(options: ProductPickerOptions = {}): Observable<PickerProduct | null> {
    const data: ProductPickerDialogData = {
      ...options,
      availability: options.availability ?? 'any',
      priceLists: options.priceLists ?? [],
    };

    return this.dialog
      .open<ProductPickerDialogComponent, ProductPickerDialogData, PickerProduct>(
        ProductPickerDialogComponent,
        {
          width: '64rem',
          maxWidth: '95vw',
          // El alto lo fija el contenido, pero nunca más allá de la pantalla: la tabla scrollea sola.
          maxHeight: '90vh',
          // El buscador es lo primero que se toca, y viene con el texto que se traía de afuera.
          autoFocus: 'first-tabbable',
          data,
        },
      )
      .afterClosed()
      .pipe(map((product) => product ?? null));
  }
}
