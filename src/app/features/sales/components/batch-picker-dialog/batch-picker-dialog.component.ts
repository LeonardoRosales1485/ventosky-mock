import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe } from '@ngx-translate/core';
import { ProductBatchDto } from '../../../../core/stock/stock-batch.model';
import { StockBatchesApiService } from '../../../../core/stock/stock-batches-api.service';
import { ExpirationChipComponent } from '../../../../shared/components/expiration-chip/expiration-chip.component';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { SaleBatchChoice, SaleProductDto } from '../../data-access/sale.model';

export interface BatchPickerDialogData {
  product: SaleProductDto;
  /** Cuánto pide la línea: un lote con menos que eso se ofrece igual, marcado como corto. */
  quantity: number;
  /** El lote ya elegido, para preseleccionarlo. `null` es la política de la sucursal. */
  current: SaleBatchChoice | null;
}

/** El lote elegido, o `null` para volver a la política de la sucursal. */
export type BatchPickerDialogResult = SaleBatchChoice | null;

/** Con qué valor la lista dice «que lo decida la política». Centinela: un radio no toma `null`. */
const AUTO = '__auto__';

/**
 * Elegir a mano de qué partida sale una línea de venta (§7.3, wireframe `1m`).
 *
 * Lista las partidas con saldo del producto en la sucursal activa, vencimiento primero —el orden
 * en que FEFO las consumiría, así que la primera es la que saldría sola—. Las vencidas se muestran
 * y se pueden elegir: qué hace con ellas la sucursal lo decide `stock.expiredPolicy` en el commit,
 * que responde `BATCH_EXPIRED` (bloqueando o pidiendo confirmación). Esconderlas acá le mentiría al
 * operador sobre lo que hay en el depósito.
 */
@Component({
  selector: 'app-batch-picker-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    MatRadioModule,
    TranslatePipe,
    ExpirationChipComponent,
    LoadStateComponent,
  ],
  templateUrl: './batch-picker-dialog.component.html',
  styleUrl: './batch-picker-dialog.component.css',
})
export class BatchPickerDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<BatchPickerDialogComponent, BatchPickerDialogResult>);
  private readonly api = inject(StockBatchesApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<BatchPickerDialogData>(MAT_DIALOG_DATA);

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly batches = signal<readonly ProductBatchDto[]>([]);
  protected readonly choice = signal<string>(this.data.current?.uuid ?? AUTO);

  protected readonly AUTO = AUTO;
  protected readonly LoadState = LoadState;

  /** El lote elegido, o `null` con la opción automática. */
  protected readonly selected = computed<ProductBatchDto | null>(() => {
    const choice = this.choice();
    return choice === AUTO ? null : (this.batches().find((batch) => batch.uuid === choice) ?? null);
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loadState.set(LoadState.Loading);
    this.api
      .getProductBatches(this.data.product.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          // Sólo lo que tiene saldo positivo: un lote en negativo no es una partida de la que despachar.
          this.batches.set(result.rows.filter((batch) => batch.quantity > 0));
          this.loadState.set(LoadState.Success);
        },
        error: () => this.loadState.set(LoadState.Error),
      });
  }

  protected isShort(batch: ProductBatchDto): boolean {
    return batch.quantity < this.data.quantity;
  }

  protected onChoice(value: string): void {
    this.choice.set(value);
  }

  protected onApply(): void {
    const batch = this.selected();
    if (!batch) {
      this.dialogRef.close(null);
      return;
    }

    this.dialogRef.close({
      uuid: batch.uuid,
      batchNumber: batch.batchNumber ?? null,
      expirationDate: batch.expirationDate ?? null,
      expirationStatus: batch.expirationStatus ?? null,
      daysToExpiration: batch.daysToExpiration ?? null,
      warehouse: batch.warehouse,
      quantity: batch.quantity,
    });
  }
}
