import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { readApiErrorData } from '../../../core/http/api-error.model';
import { allBranchesScope } from '../../../core/http/branch-scope';
import { PaginationData } from '../../../core/paginate';
import {
  AdjustmentBatchSelectionRequest,
  AdjustmentDirection,
  AdjustmentReasonDto,
  ProductStockDistributionDto,
  StockAdjustmentBatchOption,
  StockAdjustmentPayload,
  StockAdjustmentResponseDto,
} from './stock-adjustment.model';

/** Los motivos son un catálogo chico: se traen enteros en vez de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

@Service()
export class StockAdjustmentsApiService {
  private readonly http = inject(HttpClient);

  /** Motivos de ajuste —globales más los personalizados de la empresa—, ordenados por nombre. */
  getAdjustmentReasons(): Observable<AdjustmentReasonDto[]> {
    return this.http
      .post<PaginationData<AdjustmentReasonDto>>(
        apiUrl(API_ENDPOINTS.ADJUSTMENT_REASONS.PAGINATE),
        {
          page: 1,
          size: OPTIONS_PAGE_SIZE,
          ordenes: [{ tabla: 't', columna: 'name', direccion: 'ASC' }],
        },
      )
      .pipe(map((data) => data.content ?? []));
  }

  /**
   * Dónde está el stock del producto: una fila por depósito con saldo, su sucursal y cuántos lotes
   * con saldo tiene.
   *
   * Con `allBranches` la lectura abarca toda la empresa (se omite `X-Branch-Uuid`) y exige
   * `stock.view_all_branches`; sin él se limita a la sucursal activa del tab.
   */
  getDistribution(
    productUuid: string,
    allBranches = false,
  ): Observable<ProductStockDistributionDto> {
    return this.http.get<ProductStockDistributionDto>(
      apiUrl(API_ENDPOINTS.STOCK.DISTRIBUTION(productUuid)),
      allBranches ? { context: allBranchesScope() } : {},
    );
  }

  /**
   * Ajuste manual de inventario. El payload declara **cuánto hay** (`countedQuantity`) y el backend
   * deduce la dirección del signo de la diferencia.
   *
   * Puede fallar con dos respuestas que **no son errores de datos** sino preguntas: el `412`
   * ADJUSTMENT_BATCH_SELECTION_REQUIRED (hay más de un lote con saldo, falta el reparto) y el `409`
   * ADJUSTMENT_STALE_QUANTITY (el saldo cambió mientras la pantalla estaba abierta). En ambos casos
   * se reintenta el mismo request con un campo más — ver {@link readBatchSelectionRequest}.
   */
  adjust(payload: StockAdjustmentPayload): Observable<StockAdjustmentResponseDto> {
    return this.http.post<StockAdjustmentResponseDto>(
      apiUrl(API_ENDPOINTS.STOCK.ADJUSTMENT),
      payload,
    );
  }
}

/**
 * Los lotes que el `412` ofrece para repartir, leídos del `data` del error, o `null` si el error no
 * los trae con la forma esperada.
 *
 * Se valida acá y no en quien lo consume porque `data` es un `Record<string, unknown>`: es el borde
 * entre el JSON del backend y el modelo tipado, y un `412` sin lotes utilizables tiene que caer al
 * mensaje genérico en vez de abrir un popup vacío.
 */
export function readBatchSelectionRequest(
  error: unknown,
): AdjustmentBatchSelectionRequest | null {
  const data = readApiErrorData(error);
  if (!data) {
    return null;
  }

  const batches = readBatchOptions(data['batches']);
  const delta = data['delta'];
  const direction = data['direction'];

  if (batches.length === 0 || typeof delta !== 'number') {
    return null;
  }

  return {
    direction: direction === 'EGRESO' ? 'EGRESO' : ('INGRESO' as AdjustmentDirection),
    delta,
    currentQuantity: typeof data['currentQuantity'] === 'number' ? data['currentQuantity'] : 0,
    batches,
  };
}

/** Un número del `data` del error, o `null` si el backend no lo informó. */
export function readErrorNumber(error: unknown, key: string): number | null {
  const value = readApiErrorData(error)?.[key];

  return typeof value === 'number' ? value : null;
}

function readBatchOptions(value: unknown): StockAdjustmentBatchOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      return [];
    }

    const batch = raw as Record<string, unknown>;
    // Sin `uuid` la línea no se puede imputar y sin `quantity` no se sabe cuánto tiene: el lote no
    // sirve para repartir, así que se descarta en vez de viajar a medias.
    if (typeof batch['uuid'] !== 'string' || typeof batch['quantity'] !== 'number') {
      return [];
    }

    return [
      {
        uuid: batch['uuid'],
        batchNumber: typeof batch['batchNumber'] === 'string' ? batch['batchNumber'] : null,
        quantity: batch['quantity'],
        expirationDate:
          typeof batch['expirationDate'] === 'string' ? batch['expirationDate'] : null,
        unitCost: typeof batch['unitCost'] === 'number' ? batch['unitCost'] : null,
      },
    ];
  });
}
