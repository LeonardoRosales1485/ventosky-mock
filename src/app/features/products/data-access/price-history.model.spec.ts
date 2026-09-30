import { describe, expect, it } from 'vitest';
import {
  PriceChange,
  PriceHistoryDto,
  buildPriceHistoryChart,
  buildPriceHistoryQuery,
  buildPriceHistorySeedQuery,
  periodRange,
  toPaginateTimestamp,
  toPriceChanges,
} from './price-history.model';

const RETAIL = 'list-retail';
const WHOLESALE = 'list-wholesale';

function change(fields: Partial<PriceChange> & { timestamp: number }): PriceChange {
  return {
    uuid: `change-${fields.timestamp}-${fields.priceListUuid ?? RETAIL}`,
    priceListUuid: RETAIL,
    priceListName: 'Minorista',
    branchName: 'Casa central',
    price: 100,
    oldPrice: null,
    source: 'MANUAL',
    changeType: 'CREATE',
    ...fields,
  };
}

/** Mediodía, para que ningún corrimiento horario mueva el día del que se habla. */
function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime();
}

describe('periodRange', () => {
  it('counts calendar months back from today', () => {
    const { from, to } = periodRange('1M', new Date(2026, 7, 10));

    expect(from).toEqual(new Date(2026, 6, 10));
    expect(to).toEqual(new Date(2026, 7, 10));
  });

  it('crosses the year for the longer windows', () => {
    expect(periodRange('1Y', new Date(2026, 1, 3)).from).toEqual(new Date(2025, 1, 3));
    expect(periodRange('6M', new Date(2026, 1, 3)).from).toEqual(new Date(2025, 7, 3));
  });

  /** Restar un mes al 31 de marzo no puede caer en marzo otra vez. */
  it('falls back to the last day when the month is shorter', () => {
    expect(periodRange('1M', new Date(2026, 2, 31)).from).toEqual(new Date(2026, 1, 28));
  });
});

describe('toPaginateTimestamp', () => {
  /** El tope va al final del día: si no, «hasta hoy» dejaría afuera todo lo de hoy. */
  it('spans the whole day of each edge', () => {
    expect(toPaginateTimestamp(new Date(2026, 7, 5), 'start')).toBe('2026-08-05T00:00:00');
    expect(toPaginateTimestamp(new Date(2026, 7, 5), 'end')).toBe('2026-08-05T23:59:59');
  });
});

describe('buildPriceHistoryQuery', () => {
  const window = {
    productUuid: 'product-1',
    branchUuid: 'branch-1',
    from: new Date(2026, 6, 10),
    to: new Date(2026, 7, 10),
    page: 1,
    size: 500,
  };

  it('asks for the series of one product in one branch, ascending', () => {
    const query = buildPriceHistoryQuery(window);

    expect(query.filtros).toEqual([
      [{ tabla: 'products', columna: 'uuid', operacion: '=', valor: 'product-1' }],
      [{ tabla: 'branches', columna: 'uuid', operacion: '=', valor: 'branch-1' }],
      [{ tabla: 't', columna: 'date_created', operacion: '>=', valor: '2026-07-10T00:00:00' }],
      [{ tabla: 't', columna: 'date_created', operacion: '<=', valor: '2026-08-10T23:59:59' }],
    ]);
    expect(query.ordenes).toEqual([{ tabla: 't', columna: 'date_created', direccion: 'asc' }]);
  });

  /** Sin sucursal el filtro se omite; el backend igual aísla por empresa. */
  it('drops the branch filter when there is no branch', () => {
    const query = buildPriceHistoryQuery({ ...window, branchUuid: null });

    expect(query.filtros?.some((group) => group[0].tabla === 'branches')).toBe(false);
  });

  it('looks backwards for what the window started with', () => {
    const query = buildPriceHistorySeedQuery({ ...window });

    expect(query.filtros?.at(-1)).toEqual([
      { tabla: 't', columna: 'date_created', operacion: '<', valor: '2026-07-10T00:00:00' },
    ]);
    expect(query.ordenes).toEqual([{ tabla: 't', columna: 'date_created', direccion: 'desc' }]);
  });
});

describe('toPriceChanges', () => {
  it('drops the rows that cannot be a point of the series', () => {
    const rows: PriceHistoryDto[] = [
      { uuid: 'a', dateCreated: new Date(at(2026, 8, 1)).toISOString(), price: 100, priceList: { uuid: RETAIL, name: 'Minorista' } },
      { uuid: 'b', dateCreated: null, price: 100, priceList: { uuid: RETAIL, name: 'Minorista' } },
      { uuid: 'c', dateCreated: new Date(at(2026, 8, 2)).toISOString(), price: null, priceList: { uuid: RETAIL, name: 'Minorista' } },
      { uuid: 'd', dateCreated: new Date(at(2026, 8, 3)).toISOString(), price: 120, priceList: null },
    ];

    expect(toPriceChanges(rows).map((row) => row.uuid)).toEqual(['a']);
  });
});

describe('buildPriceHistoryChart', () => {
  const from = new Date(2026, 7, 1);
  const to = new Date(2026, 7, 31);
  const now = new Date(2026, 7, 20, 10);
  const priceListOrder = [RETAIL, WHOLESALE];

  /** La ventana arranca en `from`, termina en «ahora» y pasa por cada cambio. */
  it('shares one axis across every price list', () => {
    const chart = buildPriceHistoryChart({
      changes: [
        change({ timestamp: at(2026, 8, 5), price: 110 }),
        change({
          timestamp: at(2026, 8, 12),
          priceListUuid: WHOLESALE,
          priceListName: 'Mayorista',
          price: 90,
        }),
      ],
      seeds: new Map(),
      from,
      to,
      now,
      priceListOrder,
    });

    expect(chart.timestamps).toEqual([
      new Date(2026, 7, 1).getTime(),
      at(2026, 8, 5),
      at(2026, 8, 12),
      now.getTime(),
    ]);
    expect(chart.series.map((series) => series.priceListUuid)).toEqual([RETAIL, WHOLESALE]);
  });

  /** El precio vale hasta que otro lo pisa: entre dos cambios se arrastra el último. */
  it('carries the last known price forward and marks only the real changes', () => {
    const chart = buildPriceHistoryChart({
      changes: [
        change({ timestamp: at(2026, 8, 5), price: 110 }),
        change({ timestamp: at(2026, 8, 12), price: 130, oldPrice: 110, changeType: 'UPDATE' }),
      ],
      seeds: new Map(),
      from,
      to,
      now,
      priceListOrder,
    });

    const [retail] = chart.series;

    // Antes del primer cambio la lista no tenía precio: es un hueco, no un cero.
    expect(retail.values).toEqual([null, 110, 130, 130]);
    expect(retail.markers).toEqual([false, true, true, false]);
    expect(retail.changeCount).toBe(2);
    expect(retail.first).toBe(110);
    expect(retail.last).toBe(130);
  });

  /** Sin el precio anterior a la ventana, un producto quieto se vería como un gráfico vacío. */
  it('starts the window with the price the list came in with', () => {
    const chart = buildPriceHistoryChart({
      changes: [],
      seeds: new Map([[RETAIL, 80]]),
      from,
      to,
      now,
      priceListOrder,
    });

    const [retail] = chart.series;

    expect(chart.timestamps).toEqual([new Date(2026, 7, 1).getTime(), now.getTime()]);
    expect(retail.values).toEqual([80, 80]);
    expect(retail.markers).toEqual([false, false]);
    expect(retail.changeCount).toBe(0);
  });

  /** Una compra recalcula varias listas de golpe: dos filas de la misma lista y la misma marca. */
  it('keeps the price that ended up in effect when two changes share a timestamp', () => {
    const chart = buildPriceHistoryChart({
      changes: [
        change({ timestamp: at(2026, 8, 5), price: 110 }),
        change({ uuid: 'later', timestamp: at(2026, 8, 5), price: 115 }),
      ],
      seeds: new Map(),
      from,
      to,
      now,
      priceListOrder,
    });

    expect(chart.series[0].values).toEqual([null, 115, 115]);
  });

  /** La línea no se dibuja hacia el futuro, aunque la ventana llegue a fin de mes. */
  it('closes the window at now', () => {
    const chart = buildPriceHistoryChart({
      changes: [change({ timestamp: at(2026, 8, 25), price: 200 })],
      seeds: new Map([[RETAIL, 80]]),
      from,
      to,
      now,
      priceListOrder,
    });

    expect(chart.timestamps.at(-1)).toBe(now.getTime());
    expect(chart.series[0].last).toBe(80);
  });

  /** El color sale de la posición de la lista en el catálogo, no de su lugar en el gráfico. */
  it('orders the series by the catalogue, not by the data', () => {
    const chart = buildPriceHistoryChart({
      changes: [
        change({
          timestamp: at(2026, 8, 5),
          priceListUuid: WHOLESALE,
          priceListName: 'Mayorista',
          price: 90,
        }),
        change({ timestamp: at(2026, 8, 6), price: 110 }),
      ],
      seeds: new Map(),
      from,
      to,
      now,
      priceListOrder: [WHOLESALE, RETAIL],
    });

    expect(chart.series.map((series) => series.order)).toEqual([0, 1]);
    expect(chart.series.map((series) => series.priceListUuid)).toEqual([WHOLESALE, RETAIL]);
  });

  /** Una lista dada de baja después de haber tenido precios va al final, no al principio. */
  it('sends a list missing from the catalogue to the end', () => {
    const chart = buildPriceHistoryChart({
      changes: [change({ timestamp: at(2026, 8, 5), priceListUuid: 'list-gone', price: 90 })],
      seeds: new Map(),
      from,
      to,
      now,
      priceListOrder,
    });

    expect(chart.series[0].order).toBe(priceListOrder.length);
  });
});
