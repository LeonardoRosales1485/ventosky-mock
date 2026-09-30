import { Permissions } from '../../../core/auth/permissions';
import { PaginateQuery } from '../../../core/paginate';
import { UuidNameRef } from './product.model';

/**
 * Fila de `POST /price-history/paginate` (`PriceHistoryPaginateDTO`).
 *
 * Es un registro **append-only** que el backend escribe solo: cada vez que cambia el precio de un
 * producto en una lista y sucursal deja un snapshot con el valor nuevo (`price`), el anterior
 * (`oldPrice`, `null` en el alta) y de dónde vino el cambio (`source`). No se crea ni se borra por
 * API: `/save` y `/delete` responden `400`.
 */
export interface PriceHistoryDto {
  uuid: string;
  product?: UuidNameRef | null;
  priceList?: UuidNameRef | null;
  branch?: UuidNameRef | null;
  /** Precio nuevo: es el valor de la serie. */
  price?: number | null;
  /** Precio anterior; `null` cuando el producto todavía no tenía precio en esa lista. */
  oldPrice?: number | null;
  /** `CREATE` cuando no había precio previo, `UPDATE` cuando se pisó uno existente. */
  changeType?: string | null;
  /** `PriceChangeSource` del backend: qué originó el cambio. */
  source?: string | null;
  performedByUserId?: number | null;
  status?: number;
  /** Marca temporal de la serie (epoch ms, tal como Jackson serializa el `Timestamp`). */
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string | null;
}

export const PRICE_HISTORY_VIEW_PERMISSION = Permissions.priceHistoryView;

/**
 * Orígenes que declara `PriceChangeSource`. Los de venta y los de costo se listan juntos porque la
 * misma serie los mezcla: el costo vive en la lista reservada «Costo», que es una lista más.
 */
export const PRICE_CHANGE_SOURCES = [
  'MANUAL',
  'PURCHASE_RULE',
  'ADJUSTMENT_RULE',
  'TRANSFER_RULE',
  'PRICE_RULE_SAVE',
  'PRICE_LIST_SAVE',
  'PURCHASE_COST',
  'TRANSFER_COST',
  'ADJUSTMENT_COST',
  'COST_METHOD_CHANGE',
] as const;

export type PriceChangeSource = (typeof PRICE_CHANGE_SOURCES)[number];

/** Ventanas que ofrece el selector de período; `custom` son las dos fechas cargadas a mano. */
export const PRICE_HISTORY_PERIODS = ['1M', '3M', '6M', '1Y', 'custom'] as const;

export type PriceHistoryPeriod = (typeof PRICE_HISTORY_PERIODS)[number];

/** Un preset con ventana propia; `custom` no lo es, porque ahí las fechas las pone el usuario. */
export type PriceHistoryPresetPeriod = Exclude<PriceHistoryPeriod, 'custom'>;

/** Un mes es el período por defecto: es el que responde «¿cuánto se movió esto último?». */
export const DEFAULT_PRICE_HISTORY_PERIOD: PriceHistoryPresetPeriod = '1M';

/** Meses que retrocede cada preset. */
const MONTHS_BACK: Record<PriceHistoryPresetPeriod, number> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
};

/**
 * Ventana `[desde, hasta]` de un preset, contada hacia atrás desde hoy en meses de calendario (no
 * en bloques de 30 días): «un mes» es el mismo día del mes anterior, que es lo que el usuario lee.
 * Un día 31 que no existe en el mes anterior cae al último día de ese mes.
 */
export function periodRange(
  period: PriceHistoryPresetPeriod,
  today: Date,
): { from: Date; to: Date } {
  const monthsBack = MONTHS_BACK[period];
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetMonth = from.getMonth() - monthsBack;

  from.setMonth(targetMonth);
  // `setMonth` desborda cuando el día no existe en el mes destino: un mes antes del 31 de marzo
  // sería un «31 de febrero», que JavaScript convierte en marzo otra vez. Ahí se retrocede al
  // último día del mes buscado, que es lo que el usuario entiende por «un mes atrás».
  if (from.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    from.setDate(0);
  }

  return { from, to: new Date(today.getFullYear(), today.getMonth(), today.getDate()) };
}

/**
 * Fecha como la espera el paginado en una columna `timestamp`. El backend acepta `yyyy-MM-dd` y
 * `yyyy-MM-ddTHH:mm:ss` (`RepositoryImpl.parseTimestampValor`) y lo interpreta en la zona horaria
 * del servidor, así que se manda la hora local de pared: es la que el usuario eligió en el
 * calendario. El tope va al final del día para que «hasta hoy» incluya lo de hoy.
 */
export function toPaginateTimestamp(date: Date, edge: 'start' | 'end'): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  return edge === 'start' ? `${day}T00:00:00` : `${day}T23:59:59`;
}

/** Filtros comunes de la serie: el producto y la sucursal, que son los que la identifican. */
function seriesFilters(productUuid: string, branchUuid: string | null) {
  const filters = [
    [{ tabla: 'products', columna: 'uuid', operacion: '=', valor: productUuid }],
  ];

  // Los precios son por sucursal: sin este filtro la curva mezcla los recálculos de todas.
  if (branchUuid) {
    filters.push([{ tabla: 'branches', columna: 'uuid', operacion: '=', valor: branchUuid }]);
  }

  return filters;
}

export interface PriceHistoryQueryOptions {
  productUuid: string;
  branchUuid: string | null;
  from: Date;
  to: Date;
  page: number;
  size: number;
}

/**
 * Cambios del producto dentro de la ventana, en orden ascendente: es como se dibuja la línea de
 * tiempo. El backend ordena por `date_created desc` cuando el cliente no manda orden.
 */
export function buildPriceHistoryQuery(options: PriceHistoryQueryOptions): PaginateQuery {
  return {
    page: options.page,
    size: options.size,
    filtros: [
      ...seriesFilters(options.productUuid, options.branchUuid),
      [
        {
          tabla: 't',
          columna: 'date_created',
          operacion: '>=',
          valor: toPaginateTimestamp(options.from, 'start'),
        },
      ],
      [
        {
          tabla: 't',
          columna: 'date_created',
          operacion: '<=',
          valor: toPaginateTimestamp(options.to, 'end'),
        },
      ],
    ],
    ordenes: [{ tabla: 't', columna: 'date_created', direccion: 'asc' }],
  };
}

/**
 * Últimos cambios **anteriores** a la ventana, del más nuevo al más viejo. Son los que dicen con qué
 * precio entró cada lista al período: sin ellos, un producto que no cambió de precio en el último
 * mes dibujaría un gráfico vacío en vez de una línea plana, que es la verdad.
 *
 * Se pide un lote y se toma el primero de cada lista porque el paginado no sabe agrupar: `size`
 * acota cuántos cambios hacia atrás se miran, no cuántas listas se resuelven.
 */
export function buildPriceHistorySeedQuery(
  options: Omit<PriceHistoryQueryOptions, 'to'>,
): PaginateQuery {
  return {
    page: options.page,
    size: options.size,
    filtros: [
      ...seriesFilters(options.productUuid, options.branchUuid),
      [
        {
          tabla: 't',
          columna: 'date_created',
          operacion: '<',
          valor: toPaginateTimestamp(options.from, 'start'),
        },
      ],
    ],
    ordenes: [{ tabla: 't', columna: 'date_created', direccion: 'desc' }],
  };
}

/** Un cambio de precio ya normalizado: la fila cruda sin los campos opcionales ni los nulos. */
export interface PriceChange {
  uuid: string;
  timestamp: number;
  priceListUuid: string;
  priceListName: string;
  branchName: string | null;
  price: number;
  oldPrice: number | null;
  source: string | null;
  changeType: string | null;
}

/**
 * Descarta las filas que no sirven para la serie —sin fecha, sin precio o sin lista— en vez de
 * dibujarlas como huecos. Son datos que el backend no debería emitir; si aparecen, el gráfico
 * miente menos ignorándolos.
 */
export function toPriceChanges(rows: readonly PriceHistoryDto[]): PriceChange[] {
  const changes: PriceChange[] = [];

  for (const row of rows) {
    const timestamp = toTimestamp(row.dateCreated);
    const price = row.price;
    const priceListUuid = row.priceList?.uuid;

    if (timestamp === null || typeof price !== 'number' || !priceListUuid) {
      continue;
    }

    changes.push({
      uuid: row.uuid,
      timestamp,
      priceListUuid,
      priceListName: row.priceList?.name ?? priceListUuid,
      branchName: row.branch?.name ?? null,
      price,
      oldPrice: typeof row.oldPrice === 'number' ? row.oldPrice : null,
      source: row.source ?? null,
      changeType: row.changeType ?? null,
    });
  }

  return changes;
}

function toTimestamp(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** La curva de una lista de precios dentro de la ventana. */
export interface PriceHistorySeries {
  priceListUuid: string;
  name: string;
  /** Posición en el catálogo de listas: es lo que fija el color, que así no se mueve al filtrar. */
  order: number;
  /** Un valor por cada marca del eje; `null` mientras la lista todavía no tenía precio. */
  values: (number | null)[];
  /** `true` donde el punto es un cambio real y no el precio anterior arrastrado. */
  markers: boolean[];
  /** Primer y último precio conocidos en la ventana, para el resumen de la leyenda. */
  first: number | null;
  last: number | null;
  /** Cambios efectivos dentro de la ventana (los arrastres no cuentan). */
  changeCount: number;
}

export interface PriceHistoryChartData {
  /** Eje X compartido: el arranque, cada cambio y el cierre de la ventana. */
  timestamps: number[];
  series: PriceHistorySeries[];
}

export interface BuildPriceHistoryChartOptions {
  /** Cambios dentro de la ventana, en cualquier orden. */
  changes: readonly PriceChange[];
  /** Precio con el que cada lista entró a la ventana (el último cambio anterior a `from`). */
  seeds: ReadonlyMap<string, number>;
  from: Date;
  to: Date;
  /** «Ahora»: la línea no se dibuja hacia el futuro aunque la ventana llegue hasta hoy. */
  now: Date;
  /** UUIDs de las listas en el orden del catálogo; decide el color de cada serie. */
  priceListOrder: readonly string[];
}

/**
 * Arma la serie graficable: un eje X compartido por todas las listas y, para cada lista, el precio
 * vigente en cada marca de ese eje.
 *
 * El precio es una función escalonada —vale hasta que otro cambio lo pisa—, así que entre dos
 * marcas se arrastra el último valor conocido y el gráfico lo dibuja como escalón. Compartir el eje
 * es lo que permite que el tooltip liste **todas** las listas en la fecha señalada en vez de sólo
 * la línea que el puntero llegó a tocar.
 */
export function buildPriceHistoryChart(
  options: BuildPriceHistoryChartOptions,
): PriceHistoryChartData {
  const fromMs = startOfDay(options.from).getTime();
  const toMs = endOfDay(options.to).getTime();
  // La ventana termina en «ahora» cuando el tope es hoy o el futuro: una línea que sigue hasta las
  // 23:59 de hoy afirmaría un precio que todavía no se sabe si va a cambiar.
  const endMs = Math.min(Math.max(options.now.getTime(), fromMs), toMs);

  const inWindow = options.changes.filter(
    (change) => change.timestamp >= fromMs && change.timestamp <= endMs,
  );

  const timestamps = [...new Set([fromMs, ...inWindow.map((change) => change.timestamp), endMs])].sort(
    (left, right) => left - right,
  );
  const indexByTimestamp = new Map(timestamps.map((timestamp, index) => [timestamp, index]));

  const names = new Map<string, string>();
  const changesByList = new Map<string, PriceChange[]>();
  for (const change of inWindow) {
    names.set(change.priceListUuid, change.priceListName);
    const bucket = changesByList.get(change.priceListUuid);
    if (bucket) {
      bucket.push(change);
    } else {
      changesByList.set(change.priceListUuid, [change]);
    }
  }

  const priceListUuids = new Set([...changesByList.keys(), ...options.seeds.keys()]);

  const series = [...priceListUuids].map<PriceHistorySeries>((priceListUuid) => {
    const listChanges = (changesByList.get(priceListUuid) ?? [])
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp);

    const values: (number | null)[] = new Array(timestamps.length).fill(null);
    const markers: boolean[] = new Array(timestamps.length).fill(false);

    // El precio con el que la lista entró a la ventana, si ya tenía uno.
    const seed = options.seeds.get(priceListUuid);
    let current: number | null = seed ?? null;

    for (const change of listChanges) {
      const index = indexByTimestamp.get(change.timestamp);
      if (index === undefined) {
        continue;
      }
      // Dos cambios en la misma marca (una compra recalcula varias listas a la vez) dejan el
      // último: es el precio que quedó vigente.
      values[index] = change.price;
      markers[index] = true;
    }

    for (let index = 0; index < timestamps.length; index += 1) {
      const value = values[index];
      if (value === null) {
        values[index] = current;
      } else {
        current = value;
      }
    }

    const known = values.filter((value): value is number => value !== null);

    return {
      priceListUuid,
      name: names.get(priceListUuid) ?? priceListUuid,
      order: resolveOrder(priceListUuid, options.priceListOrder),
      values,
      markers,
      first: known.length > 0 ? known[0] : null,
      last: known.length > 0 ? known[known.length - 1] : null,
      changeCount: listChanges.length,
    };
  });

  series.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

  return { timestamps, series };
}

/**
 * Posición de la lista en el catálogo. Una lista que ya no está en el catálogo —dada de baja
 * después de haber tenido precios— se manda al final en vez de quedar primera con un `-1`.
 */
function resolveOrder(priceListUuid: string, priceListOrder: readonly string[]): number {
  const index = priceListOrder.indexOf(priceListUuid);
  return index === -1 ? priceListOrder.length : index;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}
