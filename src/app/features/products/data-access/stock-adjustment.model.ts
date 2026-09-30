import { Permissions } from '../../../core/auth/permissions';
import { UuidNameRef } from './product.model';

/**
 * Dirección que el backend **dedujo** del signo de la diferencia (`countedQuantity − saldo real`).
 * Son literales en castellano, no el nombre del `StockMovement.type` (`ADJUSTMENT_IN`/`OUT`).
 *
 * Desde `v2.0.0` la dirección ya no se elige: llega en la respuesta y en el `412` que pide el
 * reparto. Que la calcule el backend es lo que evita que una venta concurrente dé vuelta el signo
 * después de que la pantalla lo decidió.
 */
export const ADJUSTMENT_DIRECTIONS = ['INGRESO', 'EGRESO'] as const;

export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

/** Row of `POST /adjustment-reason/paginate` (`AdjustmentReasonDTO`). */
export interface AdjustmentReasonDto {
  uuid: string;
  name: string;
  description?: string | null;
}

/**
 * Una línea del reparto entre lotes (`StockAdjustmentBatchAllocationDTO`).
 *
 * Imputa a un lote existente (`stockBatch.uuid`) **o** abre una partida nueva (`newBatch: true`,
 * sólo válido cuando la diferencia es un ingreso). La suma de `quantity` tiene que ser exactamente
 * `abs(delta)`: repartir de menos dejaría el depósito en una cantidad que nadie pidió.
 */
export interface StockAdjustmentBatchAllocation {
  stockBatch?: { uuid: string };
  /** Abre una partida nueva en vez de imputar a una existente. Sólo en ingresos. */
  newBatch?: boolean;
  /** Siempre positiva: el signo lo pone la dirección del ajuste, no la línea. */
  quantity: number;
  /** Sólo tiene sentido con `newBatch`; es el costo con el que nace la partida. */
  unitCost?: number;
  /** `yyyy-MM-dd`. Sólo con `newBatch`. */
  expirationDate?: string;
  /** Número de la partida nueva. Obligatorio en un producto `BATCH`; los demás lo generan. */
  batchNumber?: string;
}

/**
 * Body of `POST /stock/adjustment` (`StockAdjustmentRequestDTO`, v2.0.0).
 *
 * Declara **cuánto hay**, no cuánto se mueve: el backend lee el saldo real del depósito, calcula
 * `countedQuantity − saldo` y de su signo deduce el `ADJUSTMENT_IN` o el `ADJUSTMENT_OUT`. Si la
 * diferencia da cero responde `200` sin generar movimientos.
 */
export interface StockAdjustmentPayload {
  product: { uuid: string };
  /** Define la sucursal del ajuste: en la escritura la sucursal la pone el depósito, no el header. */
  warehouse: { uuid: string };
  /** `>= 0`. El cero es válido y significa «no queda nada». */
  countedQuantity: number;
  /**
   * El saldo que la pantalla tenía a la vista. Si no coincide con el real el backend corta con
   * `409 ADJUSTMENT_STALE_QUANTITY` en vez de absorber en silencio la venta que pasó en el medio.
   * Es opcional para el backend, pero la pantalla siempre lo manda: es todo el punto de mandarlo.
   */
  expectedQuantity?: number;
  /**
   * Costo unitario de la partida que se da de alta. Aplica **sólo si la diferencia resulta un
   * ingreso** —en un egreso se ignora, no se rechaza— y además redefine el costo del producto en la
   * sucursal del depósito, que es la vía para cargar el inventario inicial con su costo.
   */
  unitCost?: number;
  adjustmentReason: { uuid: string };
  /** Opcional desde `v2.0.0`: el motivo estructurado ya justifica, esto son observaciones. */
  reasonDescription?: string;
  /**
   * Partida sobre la que se aplica el ajuste de un producto `BATCH` (§7.2). Si existe en el
   * depósito —mismo número y vencimiento— se ajusta esa; si no existe y la diferencia es un
   * ingreso, se abre con este número. Obligatoria para abrir una partida de un producto `BATCH`.
   */
  batchNumber?: string;
  /**
   * Vencimiento de la partida, `yyyy-MM-dd`. Obligatorio para ingresar en un producto con
   * `expiration_control = REQUIRED`; sobre un lote existente conserva el suyo si no viene otro.
   */
  expirationDate?: string;
  /**
   * De qué lotes sale (o a qué lotes entra) la diferencia. Se manda en el **reintento** del `412`,
   * o de entrada para abrir deliberadamente una partida nueva sobre un depósito de un solo lote.
   */
  batchAllocations?: StockAdjustmentBatchAllocation[];
}

/** Lote afectado por el ajuste (`StockAdjustmentBatchResultDTO`). */
export interface StockAdjustmentBatchResultDto {
  uuid: string;
  batchNumber?: string | null;
  /** Viaja con signo: positivo si el lote recibió, negativo si se le descontó. */
  appliedQuantity: number;
  resultingQuantity: number;
  created: boolean;
}

/** Response of `POST /stock/adjustment` (`StockAdjustmentResponseDTO`). */
export interface StockAdjustmentResponseDto {
  /** UUID que agrupa todos los `stock_movements` generados por este ajuste. */
  adjustmentUuid: string;
  product: UuidNameRef;
  warehouse: UuidNameRef;
  branch?: UuidNameRef | null;
  previousQuantity: number;
  countedQuantity: number;
  /** `countedQuantity − previousQuantity`. Cero cuando el conteo confirmó el saldo. */
  delta: number;
  adjustmentType: AdjustmentDirection;
  /**
   * Saldo del producto en **toda la sucursal** después del ajuste (`product_branches
   * .branch_quantity`): evita releer el producto para refrescar la pantalla.
   */
  branchQuantity?: number | null;
  adjustmentReason: UuidNameRef;
  reasonDescription?: string | null;
  affectedBatches?: StockAdjustmentBatchResultDto[] | null;
  performedByUser?: UuidNameRef | null;
  timestamp?: string | null;
  /** Cero cuando la diferencia dio cero: el conteo confirmó el saldo y no hubo nada que mover. */
  movementsCreated: number;
}

/**
 * Un lote con saldo entre los que el `412` ofrece para repartir
 * (`StockAdjustmentBatchOptionDTO`, en `data.batches`).
 */
export interface StockAdjustmentBatchOption {
  uuid: string;
  batchNumber?: string | null;
  quantity: number;
  /** `yyyy-MM-dd`, o ausente en el lote sin vencimiento. */
  expirationDate?: string | null;
  unitCost?: number | null;
}

/**
 * El `data` del `412 ADJUSTMENT_BATCH_SELECTION_REQUIRED`: la pregunta del backend, con todo lo que
 * hace falta para contestarla.
 */
export interface AdjustmentBatchSelectionRequest {
  direction: AdjustmentDirection;
  /** Con signo. El reparto tiene que sumar exactamente su valor absoluto. */
  delta: number;
  currentQuantity: number;
  batches: StockAdjustmentBatchOption[];
}

/** Una fila de `GET /stock/distribution/{uuid}` (`ProductStockDistributionRowDTO`). */
export interface ProductStockDistributionRowDto {
  branch?: UuidNameRef | null;
  warehouse: UuidNameRef;
  quantity: number;
  /**
   * Cuántos lotes con saldo tiene el depósito. `> 1` anticipa que guardar va a disparar el `412`
   * del reparto, así que la pantalla lo puede avisar antes de que el operador toque Guardar.
   */
  batchCount: number;
}

/** Response of `GET /stock/distribution/{uuid}` (`ProductStockDistributionDTO`). */
export interface ProductStockDistributionDto {
  product: UuidNameRef;
  totalQuantity: number;
  /** `true` cuando la lectura abarcó toda la empresa (se omitió `X-Branch-Uuid`). */
  allBranches: boolean;
  /** Los depósitos sin saldo no aparecen: la distribución dice dónde **está** el stock. */
  rows: ProductStockDistributionRowDto[];
}

/** Habilita la acción de ajuste manual de stock (`POST /stock/adjustment`). */
export const STOCK_ADJUSTMENT_PERMISSION = Permissions.stockAdjustment;

/** Habilita leer el stock de toda la empresa en vez de sólo el de la sucursal activa. */
export const STOCK_VIEW_ALL_BRANCHES_PERMISSION = Permissions.stockViewAllBranches;
