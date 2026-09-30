import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
import { TranslatePipe } from '@ngx-translate/core';
import { LoadStateComponent } from '../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../shared/components/load-state/load-state.model';
import { UuidNameRef } from '../../http/api-refs';
import { ProductSerialDto } from '../stock-serial.model';
import { StockSerialsApiService } from '../stock-serials-api.service';

export interface SerialPickerDialogData {
  /** El producto cuyas unidades se eligen. Sólo se leen `uuid` y `name`. */
  product: UuidNameRef;
  /** Cuántas unidades pide la línea: se eligen exactamente ésas (RN-17). */
  quantity: number;
  /** Las que ya estaban elegidas, para no perderlas al reabrir. */
  current: readonly string[];
  /**
   * Depósito al que se acotan las unidades ofrecidas.
   *
   * Sin él se ofrecen las de **toda la sucursal activa**, que es lo que necesita la venta: ahí el
   * depósito lo decide la política de asignación, no el cajero. El traslado sí lo manda, porque
   * despacha de un depósito concreto y ofrecer una unidad de otro terminaría en el
   * `SERIAL_NOT_AVAILABLE` del commit por un camino que la pantalla ya podía ver.
   */
  warehouse?: UuidNameRef;
  /**
   * Qué se está haciendo con las unidades, ya traducido: «se las lleva el cliente», «se van del
   * depósito». Lo pone quien abre el diálogo porque es lo único que cambia entre las dos pantallas.
   */
  lead?: string;
}

/** Los números elegidos. `undefined` (diálogo cancelado) deja la línea como estaba. */
export type SerialPickerDialogResult = readonly string[];

/**
 * Elegir **qué unidades** salen, no cuántas (§9, wireframe `1m`).
 *
 * Lista las series `IN_STOCK` del producto —en la sucursal activa, o en un depósito puntual si el
 * llamador lo declara—. **No es opcional como el lote**: un producto serializado no se puede
 * despachar sin decir cuáles salen, porque la operación marca esas filas y no otras.
 *
 * Vive en `core/` porque lo comparten la venta y el traslado, y la diferencia entre las dos es de
 * alcance y de texto, no de reglas: las dos eligen unidades disponibles, las dos exigen tantas como
 * la línea (RN-17) y las dos escanean igual.
 *
 * El buscador está arriba de todo y con el foco puesto porque el camino rápido es **escanear**: el
 * lector escribe el número y el filtro deja una sola opción, que se tilda con Enter. Tipear también
 * funciona; escanear es lo que tiene que ser instantáneo.
 */
@Component({
  selector: 'app-serial-picker-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    LoadStateComponent,
  ],
  templateUrl: './serial-picker-dialog.component.html',
  styleUrl: './serial-picker-dialog.component.css',
})
export class SerialPickerDialogComponent {
  private readonly dialogRef =
    inject(MatDialogRef<SerialPickerDialogComponent, SerialPickerDialogResult>);
  private readonly api = inject(StockSerialsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<SerialPickerDialogData>(MAT_DIALOG_DATA);

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly available = signal<readonly ProductSerialDto[]>([]);
  protected readonly search = signal('');
  protected readonly selected = signal<readonly string[]>([...this.data.current]);

  protected readonly LoadState = LoadState;

  /** Las unidades que el filtro deja a la vista. */
  protected readonly visible = computed(() => {
    const query = this.search().trim().toUpperCase();
    return this.available().filter(
      (serial) => !query || serial.serialNumber.toUpperCase().includes(query),
    );
  });

  /** Cuántas faltan para cubrir la línea. Cero habilita confirmar. */
  protected readonly remaining = computed(() =>
    Math.max(0, this.data.quantity - this.selected().length),
  );

  /**
   * Sobran unidades elegidas. Pasa al bajar la cantidad de la línea con el diálogo abierto, y hay
   * que decirlo: confirmar con más de las que pide la línea la haría rebotar en el commit.
   */
  protected readonly excess = computed(() =>
    Math.max(0, this.selected().length - this.data.quantity),
  );

  constructor() {
    this.load();
  }

  protected isSelected(serialNumber: string): boolean {
    return this.selected().includes(serialNumber);
  }

  /**
   * Tildar o destildar una unidad. Con la línea ya cubierta, tildar una más **no** reemplaza a
   * ninguna: se avisa el excedente y el operador decide cuál sacar. Elegir por él cuál devolver al
   * depósito sería adivinar.
   */
  protected onToggle(serialNumber: string): void {
    this.selected.update((current) =>
      current.includes(serialNumber)
        ? current.filter((serial) => serial !== serialNumber)
        : [...current, serialNumber],
    );
  }

  protected onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /**
   * Enter en el buscador tilda la única opción visible: es el gesto del lector de código de barras,
   * que termina la lectura con Enter. Con más de una a la vista no hace nada — no hay cuál elegir.
   */
  protected onSearchEnter(): void {
    const matches = this.visible();
    if (matches.length === 1) {
      this.onToggle(matches[0].serialNumber);
      this.search.set('');
    }
  }

  protected onConfirm(): void {
    if (this.remaining() > 0 || this.excess() > 0) {
      return;
    }
    this.dialogRef.close([...this.selected()]);
  }

  protected load(): void {
    this.loadState.set(LoadState.Loading);
    this.api
      .getProductSerials(this.data.product.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (serials) => {
          // Sólo las disponibles: una vendida, en viaje o dada de baja no se puede despachar, y
          // ofrecerla llevaría al `SERIAL_NOT_AVAILABLE` del commit por un camino que la pantalla ya
          // sabía. Con depósito declarado se acota además a ése.
          const warehouseUuid = this.data.warehouse?.uuid;
          this.available.set(
            serials.rows.filter(
              (row) =>
                row.state === 'IN_STOCK' &&
                (!warehouseUuid || row.warehouse?.uuid === warehouseUuid),
            ),
          );
          this.loadState.set(LoadState.Success);
        },
        error: () => this.loadState.set(LoadState.Error),
      });
  }
}
