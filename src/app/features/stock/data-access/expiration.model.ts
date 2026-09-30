import { Permissions } from '../../../core/auth/permissions';
import { UuidNameRef } from '../../../core/http/api-refs';
import { ExpirationStatus } from '../../../core/stock/stock-batch.model';

/** Rango del panel (`ExpirationRange`): sólo vencidas, las que vencen en ≤ N días, o todas con fecha. */
export const EXPIRATION_RANGES = ['EXPIRED', 'DAYS', 'ALL'] as const;

export type ExpirationRange = (typeof EXPIRATION_RANGES)[number];

/** Una fila del panel (`ExpirationRowDTO`). */
export interface ExpirationRowDto {
  batchUuid: string;
  batchNumber?: string | null;
  /** `yyyy-MM-dd`. */
  expirationDate: string;
  /** Negativo si ya venció: es un número ordenable que dice cuánto hace. */
  daysToExpiration: number;
  expirationStatus: ExpirationStatus;
  /** El umbral que decidió el semáforo de esta fila: el del producto o el de la empresa. */
  alertDays?: number | null;
  product: UuidNameRef;
  productSku?: string | null;
  category?: UuidNameRef | null;
  warehouse: UuidNameRef;
  branch?: UuidNameRef | null;
  quantity: number;
  unitCost?: number | null;
  /** `quantity × unitCost`: lo que vale (o se inmoviliza) en esa partida. */
  totalCost?: number | null;
}

/** Una página del panel (`ExpirationPageDTO`), vencidas primero. */
export interface ExpirationPageDto {
  rows: ExpirationRowDto[];
  total: number;
  page: number;
  size: number;
  /** `yyyy-MM-dd`: la fecha de corte con la que se calcularon los días. */
  today: string;
  /** Umbral de aviso de la empresa: el rango «próximos» por defecto. */
  alertDays: number;
}

/** Las tres tarjetas (`ExpirationSummaryDTO`): cuánto hay que sacar hoy y cuánto hay que rematar. */
export interface ExpirationSummaryDto {
  expiredBatches: number;
  expiredQuantity: number;
  /** Σ saldo × costo ponderado de las vencidas: lo inmovilizado. */
  expiredValue: number;
  dueSoonBatches: number;
  dueSoonProducts: number;
  dueSoonDays: number;
  alertBatches: number;
  alertProducts: number;
  alertDays: number;
}

/** Los filtros del panel, tal como viajan en la query de `GET /stock/expirations`. */
export interface ExpirationFilters {
  branch?: string | null;
  warehouse?: string | null;
  category?: string | null;
  range: ExpirationRange;
  /** Con `range = DAYS`: la ventana en días. Omitido, el backend usa el umbral de la empresa. */
  days?: number | null;
}

/** Panel de vencimientos y baja masiva de vencidos. */
export const STOCK_EXPIRATION_VIEW_PERMISSION = Permissions.stockExpirationView;

/** Trazabilidad de una partida: alcanza con ver stock. */
export const STOCK_VIEW_PERMISSION = Permissions.stockView;

/** Leer stock de toda la empresa, no sólo de la sucursal activa. */
export const STOCK_VIEW_ALL_BRANCHES_PERMISSION = Permissions.stockViewAllBranches;
