import { Component, DestroyRef, inject, signal } from '@angular/core';
import { formatDocument } from '../parties/party.model';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LoadState } from '../../shared/components/load-state/load-state.model';
import { TableWrapperComponent } from '../../shared/components/table-wrapper/table-wrapper.component';
import { MatTablePaginator } from '../paginate';
import { CustomerPickerApiService } from './customer-picker-api.service';
import { CustomerPickerDialogData, PickerCustomer } from './customer-picker.model';

const COLUMNS = ['name', 'document', 'priceList', 'actions'] as const;

/**
 * Selector de clientes: se busca por nombre o CUIT y se elige de la lista.
 *
 * Es un diálogo con paginado y no un desplegable porque una empresa con miles de clientes no entra
 * en un `select` —y traerlos a todos para llenarlo es un pedido que crece con la cartera—. Acá cada
 * tecleo es una consulta acotada al backend, así que el costo no depende de cuántos clientes haya.
 *
 * Busca por las dos columnas a la vez: en el mostrador, lo que el cliente dice es su nombre o su
 * CUIT, y quien atiende no tiene por qué elegir antes en qué campo va a escribir.
 *
 * Vive en `core/` como el selector de productos: hoy lo abre el mostrador, mañana una nota de
 * crédito o la cuenta corriente, sin que una pantalla importe componentes de otra.
 */
@Component({
  selector: 'app-customer-picker-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    TableWrapperComponent,
  ],
  providers: [CustomerPickerApiService],
  templateUrl: './customer-picker-dialog.component.html',
  styleUrl: './customer-picker-dialog.component.css',
})
export class CustomerPickerDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<CustomerPickerDialogComponent, PickerCustomer>>(MatDialogRef);
  private readonly api = inject(CustomerPickerApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<CustomerPickerDialogData>(MAT_DIALOG_DATA);

  /**
   * El buscador pega contra las dos columnas con las que se identifica a un cliente. El paginador
   * las combina en un `OR`, así que un mismo texto sirve para el nombre y para el CUIT.
   */
  protected readonly paginator = new MatTablePaginator<PickerCustomer>({
    fetchData: (query) => this.api.paginate(query),
    sqlDialect: environment.paginateSqlDialect,
    defaultPageSize: 10,
    globalSearchConfig: [
      { tabla: 'parties', columna: 'name' },
      { tabla: 'parties', columna: 'doc_number' },
    ],
    sortConfig: {
      name: { tabla: 'parties', columna: 'name' },
      document: { tabla: 'parties', columna: 'doc_number' },
    },
  });

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;

  protected readonly searchQuery = signal(this.data.initialSearch?.trim() ?? '');

  /** El documento tal como se muestra: `CUIT 30-…`, o `—` si el cliente no tiene. */
  protected readonly formatDocument = formatDocument;

  protected readonly displayedColumns = COLUMNS;
  protected readonly LoadState = LoadState;

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.paginator.setGlobalFilter(value));

    // Alfabético desde la primera carga: sin orden, la primera página es la que devuelva la base.
    this.paginator.handlePaginateEvent({
      pageIndex: 0,
      pageSize: this.paginator.pageSize(),
      globalFilter: this.searchQuery(),
      sortActive: 'name',
      sortDirection: 'asc',
    });
  }

  protected isSelected(customer: PickerCustomer): boolean {
    return customer.uuid === this.data.selectedUuid;
  }

  protected onSelect(customer: PickerCustomer): void {
    this.dialogRef.close(customer);
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
  }

  protected onRefresh(): void {
    this.paginator.refresh();
  }
}
