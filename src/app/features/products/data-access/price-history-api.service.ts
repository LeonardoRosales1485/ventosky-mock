import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, expand, map, reduce } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  PriceChange,
  PriceHistoryDto,
  buildPriceHistoryQuery,
  buildPriceHistorySeedQuery,
  toPriceChanges,
} from './price-history.model';

/** Filas por request. El gráfico necesita la serie entera, así que se pide de a lotes grandes. */
const PAGE_SIZE = 500;

/**
 * Tope de páginas que se encadenan para una ventana. Una compra sobre un producto con una regla de
 * N listas escribe N filas de una vez, así que un producto muy movido puede tener miles de cambios
 * en un año: antes que colgar la pantalla, se dibuja lo que entró y se avisa que quedó recortado.
 */
const MAX_PAGES = 6;

/**
 * Cuántos cambios anteriores a la ventana se miran para saber con qué precio entró cada lista. El
 * paginado no agrupa, así que se trae un lote y se toma el primero (el más reciente) de cada lista.
 */
const SEED_PAGE_SIZE = 200;

export interface PriceHistoryWindow {
  productUuid: string;
  branchUuid: string | null;
  from: Date;
  to: Date;
}

export interface PriceHistoryChanges {
  changes: PriceChange[];
  /** La ventana tenía más cambios de los que se trajeron: el gráfico muestra sólo los primeros. */
  truncated: boolean;
}

/**
 * Lectura del historial de precios (`POST /price-history/paginate`, permiso `price_history.view`).
 *
 * Es de solo lectura por diseño: el backend escribe el snapshot él mismo en cada cambio de precio y
 * bloquea `/save` y `/delete` con un `400`.
 */
@Injectable()
export class PriceHistoryApiService {
  private readonly http = inject(HttpClient);

  paginate(query: PaginateQuery): Observable<PaginationData<PriceHistoryDto>> {
    return this.http.post<PaginationData<PriceHistoryDto>>(
      apiUrl(API_ENDPOINTS.PRICE_HISTORY.PAGINATE),
      query,
    );
  }

  /** Cambios de la ventana, encadenando páginas hasta traerlos todos o alcanzar el tope. */
  listChanges(window: PriceHistoryWindow): Observable<PriceHistoryChanges> {
    const pageQuery = (page: number): PaginateQuery =>
      buildPriceHistoryQuery({ ...window, page, size: PAGE_SIZE });

    return this.paginate(pageQuery(1)).pipe(
      // El índice de `expand` es 0 para la página 1, así que la siguiente es `index + 2`.
      expand((page, index) =>
        page.last === false && index + 2 <= MAX_PAGES ? this.paginate(pageQuery(index + 2)) : EMPTY,
      ),
      reduce(
        (accumulated: { rows: PriceHistoryDto[]; complete: boolean }, page) => ({
          rows: [...accumulated.rows, ...(page.content ?? [])],
          complete: page.last !== false,
        }),
        { rows: [], complete: true },
      ),
      map(({ rows, complete }) => ({ changes: toPriceChanges(rows), truncated: !complete })),
    );
  }

  /**
   * Precio con el que cada lista entró a la ventana: el último cambio anterior a `from`. Sin esto,
   * un producto que no cambió de precio en el último mes se vería como un gráfico vacío en vez de
   * como la línea plana que realmente es.
   */
  loadSeeds(window: Omit<PriceHistoryWindow, 'to'>): Observable<Map<string, number>> {
    return this.paginate(
      buildPriceHistorySeedQuery({ ...window, page: 1, size: SEED_PAGE_SIZE }),
    ).pipe(
      map((page) => {
        const seeds = new Map<string, number>();

        // Vienen del más nuevo al más viejo: el primero de cada lista es el que estaba vigente.
        for (const change of toPriceChanges(page.content ?? [])) {
          if (!seeds.has(change.priceListUuid)) {
            seeds.set(change.priceListUuid, change.price);
          }
        }

        return seeds;
      }),
    );
  }
}
