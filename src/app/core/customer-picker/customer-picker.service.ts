import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { CustomerPickerDialogComponent } from './customer-picker-dialog.component';
import {
  CustomerPickerDialogData,
  CustomerPickerOptions,
  PickerCustomer,
} from './customer-picker.model';

/**
 * Abre el selector de clientes. Es la única puerta de entrada al diálogo: quien lo necesita pide un
 * cliente y recibe la fila del paginado, sin saber cómo se buscó.
 */
@Service()
export class CustomerPickerService {
  private readonly dialog = inject(MatDialog);

  /** El cliente elegido, o `null` si se cerró sin elegir. */
  pick(options: CustomerPickerOptions = {}): Observable<PickerCustomer | null> {
    const data: CustomerPickerDialogData = { ...options };

    return this.dialog
      .open<CustomerPickerDialogComponent, CustomerPickerDialogData, PickerCustomer>(
        CustomerPickerDialogComponent,
        {
          width: '48rem',
          maxWidth: '95vw',
          // El alto lo fija el contenido, pero nunca más allá de la pantalla: la tabla scrollea sola.
          maxHeight: '90vh',
          // El buscador es lo primero que se toca, y viene con el texto que se traía de afuera.
          autoFocus: 'first-tabbable',
          data,
        },
      )
      .afterClosed()
      .pipe(map((customer) => customer ?? null));
  }
}
