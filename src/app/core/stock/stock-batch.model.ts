import { UuidNameRef } from '../http/api-refs';

/**
 * Semáforo de vencimiento de una partida (`ExpirationStatus`): vencida, vence dentro del umbral
 * de aviso —el del producto o, si no declara, el de la empresa— o vigente. Sin fecha no hay
 * semáforo.
 */
export const EXPIRATION_STATUSES = ['EXPIRED', 'WARNING', 'OK'] as const;

export type ExpirationStatus = (typeof EXPIRATION_STATUSES)[number];

/** Una partida con saldo de un producto (`ProductBatchDTO`, fila de `GET /stock/batches/{uuid}`). */
export interface ProductBatchDto {
  uuid: string;
  batchNumber?: string | null;
  /** `yyyy-MM-dd`, o nulo en el lote sin vencimiento. */
  expirationDate?: string | null;
  /** Días hasta el vencimiento; negativo si ya venció, nulo sin fecha. */
  daysToExpiration?: number | null;
  expirationStatus?: ExpirationStatus | null;
  warehouse: UuidNameRef;
  branch?: UuidNameRef | null;
  quantity: number;
  initialQuantity?: number | null;
  weightedCost?: number | null;
}

/** Response de `GET /stock/batches/{productUuid}` (`ProductBatchesDTO`). */
export interface ProductBatchesDto {
  product: UuidNameRef;
  /** Umbral con el que se calculó el semáforo: el del producto o el de la empresa. */
  alertDays: number;
  /** `true` cuando la lectura abarcó toda la empresa (se omitió `X-Branch-Uuid`). */
  allBranches: boolean;
  totalQuantity: number;
  /** Sólo las partidas con saldo distinto de cero, vencimiento primero. */
  rows: ProductBatchDto[];
}

/** Una operación comercial que movió la partida (`BatchTraceabilitySaleDTO`). */
export interface BatchTraceabilityOperationDto {
  orderUuid: string;
  publicId?: string | null;
  dateOperation?: string | null;
  voucher?: UuidNameRef | null;
  /** `SALE` o `PURCHASE`. */
  operationType?: string | null;
  /** Cliente o proveedor; nulo es consumidor final. */
  party?: UuidNameRef | null;
  branch?: UuidNameRef | null;
  warehouse?: UuidNameRef | null;
  quantity: number;
}

/** Un movimiento del kardex de la partida (`BatchTraceabilityMovementDTO`). */
export interface BatchTraceabilityMovementDto {
  uuid: string;
  date?: string | null;
  /** `PURCHASE`, `SALE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `TRANSFER_IN`, `TRANSFER_OUT`, `TRANSFER_CANCEL`. */
  type: string;
  inbound: boolean;
  quantity: number;
  /** La operación que lo originó; `name` es su número visible cuando es una orden. */
  origin?: UuidNameRef | null;
  adjustmentReason?: UuidNameRef | null;
  reasonDescription?: string | null;
}

/** Response de `GET /stock/batch/{uuid}/traceability` (`BatchTraceabilityDTO`). */
export interface BatchTraceabilityDto {
  uuid: string;
  batchNumber?: string | null;
  expirationDate?: string | null;
  daysToExpiration?: number | null;
  expirationStatus?: ExpirationStatus | null;
  product: UuidNameRef;
  productSku?: string | null;
  warehouse: UuidNameRef;
  branch?: UuidNameRef | null;
  supplier?: UuidNameRef | null;
  dateCreated?: string | null;
  /** La operación que abrió la partida, con su número visible. */
  entryOrigin?: UuidNameRef | null;
  weightedCost?: number | null;
  enteredQuantity: number;
  soldQuantity: number;
  transferredQuantity: number;
  adjustedOutQuantity: number;
  currentQuantity: number;
  operations: BatchTraceabilityOperationDto[];
  movements: BatchTraceabilityMovementDto[];
}

/** Body de `POST /stock/expirations/write-off`. */
export interface ExpirationWriteOffPayload {
  batchUuids: string[];
  reasonDescription?: string;
}

/** Un lote dado de baja por la baja masiva (`ExpirationWriteOffBatchDTO`). */
export interface ExpirationWriteOffBatchDto {
  uuid: string;
  batchNumber?: string | null;
  expirationDate?: string | null;
  product: UuidNameRef;
  warehouse: UuidNameRef;
  quantity: number;
  resultingQuantity: number;
}

/** Response de `POST /stock/expirations/write-off`. */
export interface ExpirationWriteOffResponseDto {
  adjustmentUuid: string;
  adjustmentReason?: UuidNameRef | null;
  reasonDescription?: string | null;
  batches: ExpirationWriteOffBatchDto[];
  totalQuantity: number;
  movementsCreated: number;
}

/**
 * La trazabilidad de una partida vive en el área de stock (`/panel/stock/batch/:uuid`). El path se
 * declara acá y no en el feature porque lo enlazan la ficha del producto, el carrito y el detalle
 * de la orden, y `features/*` sólo puede importar de `core/` y `shared/`.
 */
export function stockBatchTraceabilityPath(batchUuid: string): string {
  return `/panel/stock/batch/${batchUuid}`;
}

/** Cómo se muestra una partida en una línea: número y, si tiene, vencimiento. */
export function describeBatch(batch: {
  batchNumber?: string | null;
  expirationDate?: string | null;
}): string {
  return batch.batchNumber?.trim() || '—';
}
