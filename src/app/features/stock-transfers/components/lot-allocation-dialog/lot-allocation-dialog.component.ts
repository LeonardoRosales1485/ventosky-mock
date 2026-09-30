import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { clampQuantity, quantityDecimalsOf } from '../../../../core/product/quantity-precision';
import { PickerProduct } from '../../../../core/product-picker/product-picker.model';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { TransferSourceBatch } from '../../data-access/stock-transfer.model';
import { StockTransfersApiService } from '../../data-access/stock-transfers-api.service';
import { TransferLotSplit } from '../../state/transfer-draft';

export interface LotAllocationDialogData {
  product: PickerProduct;
  /** Depósito de origen: los lotes que se ofrecen son los de ese depósito y de ningún otro. */
  sourceWarehouseUuid: string;
  sourceWarehouseName: string;
  /** Cuánto hay que repartir entre los lotes. */
  quantity: number;
  /** El reparto que ya estaba cargado, si el operador vuelve a abrir el diálogo. */
  current: readonly TransferLotSplit[];
}

/** El reparto aplicado. Una lista vacía devuelve la línea a la política automática. */
export type LotAllocationDialogResult = readonly TransferLotSplit[];

/**
 * De qué lotes del depósito de origen sale la cantidad de una línea.
 *
 * El punto de partida no es una lista vacía: los lotes llegan **en el orden en que la política de
 * la sucursal los consumiría** y el diálogo los precarga en cascada, así que abrirlo y aceptar sin
 * tocar nada da exactamente el mismo traslado que no abrirlo. Lo que el operador cambia es la
 * diferencia respecto de eso, y esa diferencia es lo que se manda como reparto explícito.
 *
 * Por qué importa el reparto: el traslado guarda **una línea por lote** y el destino recrea cada
 * partida con su número, su vencimiento y su costo. Elegir de qué lote sale no es un detalle
 * contable — decide qué vencimiento se va y cuál se queda.
 */
@Component({
  selector: 'app-lot-allocation-dialog',
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
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    LoadStateComponent,
    LocalizedDatePipe,
  ],
  templateUrl: './lot-allocation-dialog.component.html',
  styleUrl: './lot-allocation-dialog.component.css',
})
export class LotAllocationDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<LotAllocationDialogComponent, LotAllocationDialogResult>,
  );
  private readonly api = inject(StockTransfersApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<LotAllocationDialogData>(MAT_DIALOG_DATA);

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly batches = signal<readonly TransferSourceBatch[]>([]);

  /** Cuánto se le imputó a cada lote, por uuid. Es el estado que el diálogo edita. */
  private readonly allocation = signal<ReadonlyMap<string, number>>(new Map());

  private readonly decimals = quantityDecimalsOf(this.data.product);

  protected readonly allocated = computed(() =>
    [...this.allocation().values()].reduce((total, quantity) => total + quantity, 0),
  );

  /** Lo que falta repartir. Negativo significa que el reparto se pasó de la cantidad de la línea. */
  protected readonly remaining = computed(() =>
    round(this.data.quantity - this.allocated(), this.decimals),
  );

  protected readonly isBalanced = computed(() => this.remaining() === 0);

  protected readonly LoadState = LoadState;

  constructor() {
    this.load();
  }

  protected quantityFor(batch: TransferSourceBatch): number {
    return this.allocation().get(batch.uuid) ?? 0;
  }

  /**
   * La partida venció y la política de la sucursal no la deja salir: la fila se muestra —el
   * operador tiene que ver que ese saldo existe y por qué no lo puede usar— pero no admite
   * cantidad. Con `WARN` o `ALLOW` llega en `false` y se imputa como cualquier otra.
   */
  protected isBlocked(batch: TransferSourceBatch): boolean {
    return batch.blocked === true;
  }

  /** Venció, la deje salir la política o no: es lo que pinta el semáforo (§7.4). */
  protected isExpired(batch: TransferSourceBatch): boolean {
    return batch.expired === true;
  }

  protected onQuantityChange(batch: TransferSourceBatch, raw: number | string): void {
    if (this.isBlocked(batch)) {
      return;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    const quantity = Number.isFinite(value) && value > 0 ? clampQuantity(value, this.decimals) : 0;
    this.allocation.update((current) => new Map(current).set(batch.uuid, quantity));
  }

  /**
   * Manda lo que falta a este lote. Es el atajo del reparto de a dos: se pone la cantidad en el que
   * uno quiere vaciar y el resto cae en el otro sin tener que restar de cabeza.
   */
  protected onFill(batch: TransferSourceBatch): void {
    const missing = this.remaining();
    if (missing <= 0 || this.isBlocked(batch)) {
      return;
    }

    const current = this.quantityFor(batch);
    this.onQuantityChange(batch, current + missing);
  }

  protected onRetry(): void {
    this.load();
  }

  protected onApply(): void {
    if (!this.isBalanced()) {
      return;
    }

    const allocation = this.allocation();
    this.dialogRef.close(
      this.batches()
        .filter((batch) => (allocation.get(batch.uuid) ?? 0) > 0)
        .map((batch) => ({ batch, quantity: allocation.get(batch.uuid) as number })),
    );
  }

  /** Vuelve al reparto que haría la política de la sucursal: cascada sobre el orden que devolvió. */
  protected onResetToPolicy(): void {
    this.allocation.set(cascade(this.batches(), this.data.quantity, this.decimals));
  }

  private load(): void {
    this.loadState.set(LoadState.Loading);

    this.api
      .sourceBatches(this.data.sourceWarehouseUuid, this.data.product.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batches) => {
          this.batches.set(batches);
          this.allocation.set(this.initialAllocation(batches));
          this.loadState.set(LoadState.Success);
        },
        error: () => this.loadState.set(LoadState.Error),
      });
  }

  /**
   * El reparto con el que abre el diálogo: el que ya estaba cargado si el operador vuelve, y si no
   * el que haría la política — así abrir y aceptar sin tocar nada no cambia el traslado.
   *
   * Un lote guardado que ya no está en la lista se descarta: se consumió mientras tanto, y volver a
   * mandarlo sería despachar de un lote que no existe.
   */
  private initialAllocation(
    batches: readonly TransferSourceBatch[],
  ): ReadonlyMap<string, number> {
    if (this.data.current.length === 0) {
      return cascade(batches, this.data.quantity, this.decimals);
    }

    // Un lote que se bloqueó mientras la pantalla estaba abierta —venció hoy— se descarta como si
    // se hubiera consumido: mandarlo sería despachar una partida que el backend rechaza.
    const available = new Set(
      batches.filter((batch) => !batch.blocked).map((batch) => batch.uuid),
    );
    const restored = new Map<string, number>();
    for (const lot of this.data.current) {
      if (available.has(lot.batch.uuid)) {
        restored.set(lot.batch.uuid, lot.quantity);
      }
    }

    return restored.size > 0 ? restored : cascade(batches, this.data.quantity, this.decimals);
  }
}

/**
 * Reparte la cantidad en cascada sobre los lotes en el orden recibido: llena el primero hasta su
 * saldo, sigue con el siguiente. Es exactamente lo que hace el backend con la política de la
 * sucursal, replicado acá para que el punto de partida del diálogo no sea una sorpresa.
 *
 * Los lotes bloqueados por la política de vencidos quedan en cero, igual que `FEFO` los saltea al
 * repartir (RN-04): precargarlos daría un reparto que el despacho rechaza con `BATCH_EXPIRED`.
 *
 * Si los lotes no alcanzan, lo que sobra queda sin repartir: el diálogo lo muestra en rojo en vez
 * de forzarlo sobre el último lote, que es una decisión que no le corresponde tomar.
 */
function cascade(
  batches: readonly TransferSourceBatch[],
  quantity: number,
  decimals: number | null,
): ReadonlyMap<string, number> {
  const allocation = new Map<string, number>();
  let remaining = quantity;

  for (const batch of batches) {
    if (remaining <= 0 || batch.blocked) {
      allocation.set(batch.uuid, 0);
      continue;
    }

    const take = round(Math.min(remaining, batch.availableQuantity ?? 0), decimals);
    allocation.set(batch.uuid, take);
    remaining = round(remaining - take, decimals);
  }

  return allocation;
}

/**
 * Redondea a la precisión de la unidad del producto. Las cantidades pueden ser fraccionarias, y sin
 * esto la resta acumulada deja restos de 1e-13 que hacen que el reparto nunca cierre.
 */
function round(value: number, decimals: number | null): number {
  const places = decimals ?? 6;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
