import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  ChartDataset,
  ChartType,
  LineController,
  LineElement,
  LinearScale,
  Plugin,
  PointElement,
  TimeScale,
  Tooltip,
  TooltipItem,
} from 'chart.js';
// El eje temporal necesita un adaptador de fechas; el de date-fns es el que Chart.js documenta.
import 'chartjs-adapter-date-fns';
import { ThemeService } from '../../../core/theme/theme.service';

// La cruceta es un plugin propio, así que su configuración no existe en los tipos de Chart.js: se
// declara acá para que `options.plugins.crosshair` sea tan tipada como el resto.
declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    crosshair?: { color: string };
  }
}

// Sólo lo que dibuja este componente: registrar `Chart.register(...registerables)` arrastraría los
// controladores de todos los tipos de gráfico al bundle.
Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip);

/** Una curva del gráfico. `data` tiene un valor por cada marca del eje X, o `null` si no existe. */
export interface LineChartSeries {
  /** Identidad estable de la serie: es la que decide su color, no su posición en el arreglo. */
  key: string;
  label: string;
  /** Color de la línea, ya resuelto por quien la dibuja (una ranura de la paleta categórica). */
  color: string;
  data: readonly (number | null)[];
  /**
   * Dónde poner marcador: `true` en los puntos que son un dato real y `false` en los que sólo
   * arrastran el valor anterior. Sin esto, una serie escalonada se llena de puntos que no existen.
   */
  markers?: readonly boolean[];
  hidden?: boolean;
}

/** Grosor de la línea y radio del marcador, fijos: la data es lo único que puede ser fuerte. */
const LINE_WIDTH = 2;
const POINT_RADIUS = 4;
const POINT_HOVER_RADIUS = 6;
/** Anillo del color de la superficie: mantiene legible el punto donde dos líneas se cruzan. */
const POINT_RING_WIDTH = 2;

/**
 * Gráfico de líneas sobre un eje temporal, construido con Chart.js.
 *
 * Todas las series comparten el eje X —quien lo usa arma esa grilla— porque es lo que permite que
 * el tooltip liste **todas** las curvas en la fecha señalada en vez de sólo la que el puntero llegó
 * a tocar. Una cruceta marca esa fecha, para que el lector apunte a un día y no a una línea de 2px.
 *
 * Es una pieza de presentación: no sabe de precios ni de listas, sólo de series, valores y de cómo
 * formatearlos. Los colores del cromo (ejes, grilla, tooltip) salen de los tokens de Material, así
 * que el gráfico sigue al tema claro/oscuro sin que quien lo usa tenga que decir nada.
 */
@Component({
  selector: 'app-line-chart',
  templateUrl: './line-chart.component.html',
  styleUrl: './line-chart.component.css',
})
export class LineChartComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly theme = inject(ThemeService);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /** Marcas del eje X en epoch ms, ascendentes y compartidas por todas las series. */
  readonly xValues = input.required<readonly number[]>();
  readonly series = input.required<readonly LineChartSeries[]>();

  /** Cómo se escribe un valor en el tooltip. El eje Y usa {@link tickFormat}. */
  readonly valueFormat = input.required<(value: number) => string>();
  /** Cómo se escribe un valor en las marcas del eje Y; por defecto, igual que en el tooltip. */
  readonly valueTickFormat = input<(value: number) => string>();
  /** Cómo se escribe una fecha en las marcas del eje X. */
  readonly tickFormat = input.required<(timestamp: number) => string>();
  /** Cómo se escribe la fecha en el encabezado del tooltip; por defecto, igual que el eje. */
  readonly tooltipDateFormat = input<(timestamp: number) => string>();

  /** El gráfico es una imagen para el lector de pantalla: los datos viven en la tabla gemela. */
  readonly ariaLabel = input.required<string>();

  /**
   * Escalonado: el valor se mantiene hasta el próximo punto en vez de interpolarse. Es lo correcto
   * para magnitudes que cambian de golpe —un precio vale hasta que otro lo pisa— y lo incorrecto
   * para las que evolucionan de forma continua.
   */
  readonly stepped = input(true);

  /** Alto del área de dibujo, con las etiquetas del eje X incluidas. */
  readonly height = input('20rem');

  private chart: Chart<'line'> | null = null;

  /** Colores del cromo, releídos cada vez que cambia el tema (los tokens resuelven a otro valor). */
  private readonly chrome = computed(() => {
    this.theme.theme();
    return this.readChrome();
  });

  constructor() {
    effect(() => {
      const config = this.buildConfig();

      if (!this.chart) {
        this.chart = new Chart(this.canvasRef().nativeElement, config);
        return;
      }

      this.chart.data = config.data;
      this.chart.options = config.options ?? {};
      // Sin animación: al recargar por un filtro el gráfico se reemplaza en el lugar, sin el
      // parpadeo de volver a dibujarse desde cero.
      this.chart.update('none');
    });

    this.destroyRef.onDestroy(() => {
      this.chart?.destroy();
      this.chart = null;
    });
  }

  private buildConfig(): ChartConfiguration<'line'> {
    const chrome = this.chrome();
    const xValues = [...this.xValues()];
    const valueFormat = this.valueFormat();
    const valueTickFormat = this.valueTickFormat() ?? valueFormat;
    const tickFormat = this.tickFormat();
    const tooltipDateFormat = this.tooltipDateFormat() ?? tickFormat;
    const stepped = this.stepped();

    const datasets = this.series().map<ChartDataset<'line', (number | null)[]>>((series) => {
      const markers = series.markers;

      return {
        label: series.label,
        data: [...series.data],
        hidden: series.hidden === true,
        borderColor: series.color,
        backgroundColor: series.color,
        borderWidth: LINE_WIDTH,
        borderJoinStyle: 'round',
        borderCapStyle: 'round',
        stepped: stepped ? 'after' : false,
        tension: 0,
        // Un hueco es un tramo sin dato, no un valor a interpolar: la línea arranca donde empieza.
        spanGaps: false,
        pointBackgroundColor: series.color,
        pointBorderColor: chrome.surface,
        pointBorderWidth: POINT_RING_WIDTH,
        pointRadius: (context) => pointRadius(markers, context.dataIndex, POINT_RADIUS),
        pointHoverRadius: (context) => pointRadius(markers, context.dataIndex, POINT_HOVER_RADIUS),
      };
    });

    return {
      type: 'line',
      data: { labels: xValues, datasets },
      plugins: [crosshairPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // El puntero apunta a una fecha, no a una línea: el tooltip sale con todas las series de
        // esa columna sin necesidad de acertarle a ninguna.
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        layout: { padding: { top: 8, right: 8 } },
        scales: {
          x: {
            type: 'time',
            time: { tooltipFormat: 'PP' },
            grid: { display: false },
            border: { color: chrome.axis },
            ticks: {
              color: chrome.muted,
              // Sin rotar y con aire entre marcas: el eje es referencia, no protagonista.
              maxRotation: 0,
              autoSkipPadding: 24,
              callback: (value) => tickFormat(Number(value)),
            },
          },
          y: {
            grace: '8%',
            grid: { color: chrome.grid, drawTicks: false },
            border: { display: false },
            ticks: {
              color: chrome.muted,
              padding: 8,
              callback: (value) => valueTickFormat(Number(value)),
            },
          },
        },
        plugins: {
          // La leyenda la dibuja quien usa el componente: en HTML puede además llevar el último
          // valor de cada serie y ser el control que las prende y apaga.
          legend: { display: false },
          tooltip: {
            backgroundColor: chrome.tooltipSurface,
            titleColor: chrome.tooltipInk,
            bodyColor: chrome.tooltipInk,
            borderColor: chrome.grid,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            // Una raya del color de la serie: a esta densidad un cuadrado relleno es tinta de más.
            usePointStyle: true,
            callbacks: {
              title: (items: TooltipItem<'line'>[]) =>
                items.length > 0 ? tooltipDateFormat(Number(items[0].parsed.x)) : '',
              // El valor va primero: acá el lector ya sabe qué serie mira y lo que busca es el número.
              label: (item: TooltipItem<'line'>) =>
                item.parsed.y === null
                  ? ''
                  : `${valueFormat(item.parsed.y)} · ${item.dataset.label ?? ''}`,
              labelPointStyle: () => ({ pointStyle: 'line' as const, rotation: 0 }),
            },
            filter: (item: TooltipItem<'line'>) => item.parsed.y !== null,
          },
          crosshair: { color: chrome.axis },
        },
      },
    };
  }

  /** Tokens de Material resueltos a color concreto: el canvas no entiende `var(--…)`. */
  private readChrome(): ChartChrome {
    const styles = getComputedStyle(this.host.nativeElement);
    const read = (token: string, fallback: string): string =>
      styles.getPropertyValue(token).trim() || fallback;

    return {
      muted: read('--line-chart-muted', '#898781'),
      grid: read('--line-chart-grid', '#e1e0d9'),
      axis: read('--line-chart-axis', '#c3c2b7'),
      surface: read('--line-chart-surface', '#ffffff'),
      tooltipSurface: read('--line-chart-tooltip-surface', '#2f3033'),
      tooltipInk: read('--line-chart-tooltip-ink', '#f2f0f4'),
    };
  }
}

interface ChartChrome {
  muted: string;
  grid: string;
  axis: string;
  surface: string;
  tooltipSurface: string;
  tooltipInk: string;
}

/** Sin `markers` todos los puntos se dibujan; con él, sólo los que son un dato real. */
function pointRadius(
  markers: readonly boolean[] | undefined,
  index: number,
  radius: number,
): number {
  return !markers || markers[index] ? radius : 0;
}

/**
 * Cruceta vertical sobre la fecha señalada. Chart.js no la trae, y sin ella el lector tiene que
 * adivinar a qué punto del eje corresponde el tooltip.
 */
const crosshairPlugin: Plugin<'line', { color: string }> = {
  id: 'crosshair',
  defaults: { color: 'rgba(0, 0, 0, 0.3)' },
  afterDatasetsDraw(chart, _args, options) {
    const active = chart.getActiveElements();
    if (active.length === 0) {
      return;
    }

    const { top, bottom } = chart.chartArea;
    const x = active[0].element.x;
    const context = chart.ctx;

    context.save();
    context.beginPath();
    context.lineWidth = 1;
    context.strokeStyle = options.color;
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.stroke();
    context.restore();
  },
};
