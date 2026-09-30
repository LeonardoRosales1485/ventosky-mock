import { Component, computed, inject, signal } from '@angular/core';
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
import {
  QuantityDecimals,
  isQuantityPrecisionValid,
  quantityStep,
  roundQuantity,
} from '../../../../core/product/quantity-precision';
import {
  AdjustmentDirection,
  StockAdjustmentBatchAllocation,
  StockAdjustmentBatchOption,
} from '../../data-access/stock-adjustment.model';

export interface BatchAllocationDialogData {
  productName: string;
  warehouseName: string;
  /** Dirección que dedujo el backend: decide si se puede abrir una partida nueva. */
  direction: AdjustmentDirection;
  /** Con signo, tal cual lo informó el `412`. Lo que hay que repartir es su valor absoluto. */
  delta: number;
  currentQuantity: number;
  batches: readonly StockAdjustmentBatchOption[];
  /** Decimales que admite la unidad del producto; el reparto se mide con la misma vara. */
  unitDecimalPlaces: QuantityDecimals;
  /**
   * Si el producto lleva partidas (`stock_tracking = BATCH`): la partida nueva necesita número, y
   * el vencimiento es obligatorio cuando además lo exige (`expiration_control = REQUIRED`).
   */
  batchTracked?: boolean;
  expirationRequired?: boolean;
}

/** El reparto que el operador armó, listo para reintentar el ajuste. */
export type BatchAllocationDialogResult = StockAdjustmentBatchAllocation[];

/** Una fila del reparto: un lote existente, con lo que el operador le imputa. */
interface AllocationRow {
  uuid: string;
  batchNumber: string | null;
  available: number;
  expirationDate: string | null;
  unitCost: number | null;
  quantity: number | null;
}

/** La partida nueva, cuando el ingreso no entra en ninguna de las que ya están. */
interface NewBatchRow {
  enabled: boolean;
  quantity: number | null;
  unitCost: number | null;
  expirationDate: string | null;
  batchNumber: string;
}

/**
 * Reparto de la diferencia de un ajuste entre los lotes del depósito.
 *
 * No es un formulario de corrección de errores: es la respuesta a la pregunta que hace el backend
 * con `412 ADJUSTMENT_BATCH_SELECTION_REQUIRED`. Con más de un lote con saldo, de qué partida son
 * las unidades que faltan o sobran lo sabe quien contó, así que el ajuste se detiene acá y sigue
 * con el mismo request más `batchAllocations`.
 *
 * La suma tiene que dar **exactamente** la diferencia —el backend rechaza el reparto que no cuadra,
 * y repartir de menos dejaría el depósito en una cantidad que nadie pidió—, así que el botón de
 * confirmar sólo se habilita cuando el restante llega a cero.
 */
@Component({
  selector: 'app-batch-allocation-dialog',
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
  ],
  templateUrl: './batch-allocation-dialog.component.html',
  styleUrl: './batch-allocation-dialog.component.css',
})
export class BatchAllocationDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<BatchAllocationDialogComponent, BatchAllocationDialogResult>,
  );

  protected readonly data = inject<BatchAllocationDialogData>(MAT_DIALOG_DATA);

  /** Cuánto hay que repartir, sin signo: la dirección ya la dice `data.direction`. */
  protected readonly target = Math.abs(this.data.delta);

  protected readonly isIngreso = this.data.direction === 'INGRESO';

  protected readonly step = quantityStep(this.data.unitDecimalPlaces);

  protected readonly rows = signal<readonly AllocationRow[]>(
    this.data.batches.map((batch) => ({
      uuid: batch.uuid,
      batchNumber: batch.batchNumber ?? null,
      available: batch.quantity,
      expirationDate: batch.expirationDate ?? null,
      unitCost: batch.unitCost ?? null,
      quantity: null,
    })),
  );

  /** Sólo el ingreso puede abrir una partida: no se descuenta de un lote que no existe. */
  protected readonly newBatch = signal<NewBatchRow>({
    enabled: false,
    quantity: null,
    unitCost: null,
    expirationDate: null,
    batchNumber: '',
  });

  protected readonly batchTracked = this.data.batchTracked === true;
  protected readonly expirationRequired = this.data.expirationRequired === true;

  protected readonly allocated = computed(() => {
    const fromBatches = this.rows().reduce((total, row) => total + (row.quantity ?? 0), 0);
    const fresh = this.newBatch();

    return roundQuantity(
      fromBatches + (fresh.enabled ? (fresh.quantity ?? 0) : 0),
      this.data.unitDecimalPlaces,
    );
  });

  /** Lo que falta repartir. Negativo es haberse pasado, y también bloquea el guardado. */
  protected readonly remaining = computed(() =>
    roundQuantity(this.target - this.allocated(), this.data.unitDecimalPlaces),
  );

  /**
   * En un egreso, los lotes a los que se les pidió más de lo que tienen. El backend responde `412
   * ADJUSTMENT_BATCH_INSUFFICIENT` por el primero que encuentra; mostrarlos todos evita el ida y
   * vuelta de corregirlos de a uno.
   */
  protected readonly overdrawn = computed(() => {
    if (this.isIngreso) {
      return new Set<string>();
    }

    return new Set(
      this.rows()
        .filter((row) => (row.quantity ?? 0) > row.available)
        .map((row) => row.uuid),
    );
  });

  /** Las cantidades que no entran en la precisión de la unidad del producto. */
  protected readonly imprecise = computed(() => {
    const decimals = this.data.unitDecimalPlaces;

    return new Set(
      this.rows()
        .filter((row) => row.quantity !== null && !isQuantityPrecisionValid(row.quantity, decimals))
        .map((row) => row.uuid),
    );
  });

  protected readonly canConfirm = computed(
    () =>
      this.remaining() === 0 &&
      this.allocated() > 0 &&
      this.overdrawn().size === 0 &&
      this.imprecise().size === 0 &&
      this.rows().every((row) => (row.quantity ?? 0) >= 0) &&
      this.isNewBatchValid(),
  );

  protected onQuantityChange(uuid: string, value: string): void {
    const quantity = parseQuantity(value);

    this.rows.update((rows) =>
      rows.map((row) => (row.uuid === uuid ? { ...row, quantity } : row)),
    );
  }

  protected onNewBatchToggle(enabled: boolean): void {
    this.newBatch.update((batch) =>
      // Apagarla limpia lo cargado: dejarlo escrito haría que volver a prenderla arrastre un costo
      // que el operador ya descartó.
      enabled
        ? { ...batch, enabled }
        : { enabled, quantity: null, unitCost: null, expirationDate: null, batchNumber: '' },
    );
  }

  protected onNewBatchQuantityChange(value: string): void {
    this.newBatch.update((batch) => ({ ...batch, quantity: parseQuantity(value) }));
  }

  protected onNewBatchCostChange(value: string): void {
    this.newBatch.update((batch) => ({ ...batch, unitCost: parseQuantity(value) }));
  }

  protected onNewBatchExpirationChange(value: string): void {
    this.newBatch.update((batch) => ({ ...batch, expirationDate: value.trim() || null }));
  }

  protected onNewBatchNumberChange(value: string): void {
    this.newBatch.update((batch) => ({ ...batch, batchNumber: value }));
  }

  /** Reparte lo que falta en el primer lote que lo admita: el atajo del reparto de una sola línea. */
  protected onFillRemaining(uuid: string): void {
    const row = this.rows().find((candidate) => candidate.uuid === uuid);
    if (!row) {
      return;
    }

    const missing = roundQuantity(
      (row.quantity ?? 0) + this.remaining(),
      this.data.unitDecimalPlaces,
    );
    // En un egreso el tope es lo que el lote tiene: ofrecer más sería ofrecer el 412 siguiente.
    const capped = this.isIngreso ? missing : Math.min(missing, row.available);

    this.rows.update((rows) =>
      rows.map((candidate) =>
        candidate.uuid === uuid ? { ...candidate, quantity: capped > 0 ? capped : null } : candidate,
      ),
    );
  }

  protected onConfirm(): void {
    if (!this.canConfirm()) {
      return;
    }

    const allocations: StockAdjustmentBatchAllocation[] = this.rows()
      .filter((row) => (row.quantity ?? 0) > 0)
      .map((row) => ({ stockBatch: { uuid: row.uuid }, quantity: row.quantity as number }));

    const fresh = this.newBatch();
    if (fresh.enabled && (fresh.quantity ?? 0) > 0) {
      const batchNumber = fresh.batchNumber.trim();
      allocations.push({
        newBatch: true,
        quantity: fresh.quantity as number,
        ...(fresh.unitCost !== null ? { unitCost: fresh.unitCost } : {}),
        ...(fresh.expirationDate ? { expirationDate: fresh.expirationDate } : {}),
        ...(batchNumber ? { batchNumber } : {}),
      });
    }

    this.dialogRef.close(allocations);
  }

  private isNewBatchValid(): boolean {
    const fresh = this.newBatch();
    if (!fresh.enabled) {
      return true;
    }

    return (
      fresh.quantity !== null &&
      fresh.quantity > 0 &&
      isQuantityPrecisionValid(fresh.quantity, this.data.unitDecimalPlaces) &&
      (fresh.unitCost === null || fresh.unitCost >= 0) &&
      // Un producto con partidas no abre una sin número, ni sin fecha cuando la exige (RN-03).
      (!this.batchTracked || fresh.batchNumber.trim() !== '') &&
      (!this.expirationRequired || fresh.expirationDate !== null)
    );
  }
}

/** El valor del `<input type="number">`, o `null` si está vacío o no es un número. */
function parseQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}
