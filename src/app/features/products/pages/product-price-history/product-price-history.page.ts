import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DateAdapter, provideNativeDateAdapter } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { ThemeService } from '../../../../core/theme/theme.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import {
  LineChartComponent,
  LineChartSeries,
} from '../../../../shared/components/line-chart/line-chart.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { CHART_SERIES_SLOTS, chartSeriesColor } from '../../../../shared/utils/chart-palette';
import { PRODUCTS_PATH, productEditPath } from '../../../../core/product/product-page.paths';
import { PriceListDto } from '../../data-access/product.model';
import { ProductsApiService } from '../../data-access/products-api.service';
import { PriceHistoryApiService } from '../../data-access/price-history-api.service';
import {
  DEFAULT_PRICE_HISTORY_PERIOD,
  PRICE_HISTORY_PERIODS,
  PRICE_HISTORY_VIEW_PERMISSION,
  PriceChange,
  PriceHistoryPeriod,
  buildPriceHistoryChart,
  periodRange,
} from '../../data-access/price-history.model';

/**
 * Moneda con la que se rotula el eje y el tooltip. Es la misma que `app-currency-display` usa por
 * defecto, para que el gráfico y las tablas de la pantalla no digan dos cosas distintas.
 */
const CHART_CURRENCY = 'ARS';

/** A partir de acá el eje X rotula mes y año en vez de día y mes: un año no entra por día. */
const LONG_WINDOW_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Una lista en la leyenda: identidad, color, precio con el que cierra y cuánto se movió. */
interface PriceHistoryLegendRow {
  priceListUuid: string;
  name: string;
  /** `null` cuando la lista quedó fuera del tope de series y por lo tanto no se grafica. */
  color: string | null;
  last: number | null;
  /** Diferencia contra el precio con el que la lista entró al período. */
  delta: number | null;
  deltaPercent: number | null;
  changeCount: number;
  hidden: boolean;
}

/**
 * Evolución del precio de un producto: el gráfico de la serie que registra
 * `POST /price-history/paginate` más la tabla de los cambios que la componen.
 *
 * La serie se identifica por la terna **producto + lista + sucursal**: los precios son por
 * sucursal, así que sin filtrar por una la curva mezclaría los recálculos de todas. Por eso la
 * pantalla siempre manda una sucursal —arranca con la activa— y no ofrece un «todas».
 *
 * Un precio es una función escalonada: vale hasta que otro cambio lo pisa. De ahí dos decisiones
 * que hacen al gráfico honesto:
 *
 * - antes de la ventana se busca el último cambio de cada lista, para que un producto que no
 *   cambió de precio en el último mes se vea como la línea plana que es y no como un gráfico
 *   vacío;
 * - todas las listas comparten el eje X, que es lo que permite que el tooltip liste el precio de
 *   todas en la fecha señalada.
 *
 * El historial lo escribe el backend solo y no se puede editar, así que la pantalla es de lectura:
 * lo único que se elige es la ventana, la sucursal y qué listas mirar.
 */
@Component({
  selector: 'app-product-price-history-page',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    LineChartComponent,
    LoadStateComponent,
    PageHeaderComponent,
  ],
  providers: [ProductsApiService, PriceHistoryApiService, provideNativeDateAdapter()],
  templateUrl: './product-price-history.page.html',
  styleUrl: './product-price-history.page.css',
})
export class ProductPriceHistoryPage implements OnInit {
  private readonly productsApi = inject(ProductsApiService);
  private readonly priceHistoryApi = inject(PriceHistoryApiService);
  private readonly auth = inject(AuthService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly dateAdapter = inject<DateAdapter<Date>>(DateAdapter);
  private readonly destroyRef = inject(DestroyRef);
  private readonly language = inject(LanguageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly LoadState = LoadState;
  protected readonly periods = PRICE_HISTORY_PERIODS;
  protected readonly seriesSlots = CHART_SERIES_SLOTS;

  private readonly productUuid = this.route.snapshot.paramMap.get('uuid') ?? '';

  /** Sin `price_history.view` el paginado responde 403: la pantalla lo dice en vez de pedirlo. */
  protected readonly canViewPriceHistory = this.auth.hasPermission(PRICE_HISTORY_VIEW_PERMISSION);

  protected readonly loadState = signal<LoadState>(LoadState.Loading);

  /**
   * Hay una recarga en vuelo por un cambio de filtro. El gráfico anterior se mantiene atenuado en
   * lugar de dar lugar a un esqueleto: sin salto de layout ni parpadeo.
   */
  protected readonly refreshing = signal(false);

  protected readonly productName = signal('');
  protected readonly priceLists = signal<readonly PriceListDto[]>([]);
  protected readonly branches = this.auth.availableBranches;

  protected readonly period = signal<PriceHistoryPeriod>(DEFAULT_PRICE_HISTORY_PERIOD);
  protected readonly from = signal(periodRange(DEFAULT_PRICE_HISTORY_PERIOD, new Date()).from);
  protected readonly to = signal(periodRange(DEFAULT_PRICE_HISTORY_PERIOD, new Date()).to);
  protected readonly branchUuid = signal(this.auth.selectedBranchUuid());

  /** Listas apagadas desde la leyenda. Sólo esconden: no se vuelve a pedir nada al servidor. */
  private readonly hiddenPriceLists = signal<ReadonlySet<string>>(new Set());

  private readonly changes = signal<readonly PriceChange[]>([]);
  private readonly seeds = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly truncated = signal(false);

  /** El «ahora» del gráfico, congelado en cada carga: la línea no se dibuja hacia el futuro. */
  private readonly loadedAt = signal(new Date());

  /** El tope no puede ser anterior al inicio; mientras lo sea no se pide nada. */
  protected readonly invalidRange = computed(() => this.from().getTime() > this.to().getTime());

  /** Hasta hoy: el historial no tiene cambios futuros que mostrar. */
  protected readonly maxDate = new Date();

  /**
   * Orden estable de las listas, y con él el color de cada serie: primero el catálogo —alfabético,
   * como lo devuelve el backend— y detrás las listas que sólo aparecen en el historial, que son las
   * que se dieron de baja después de haber tenido precios. Al filtrar, las que quedan no se
   * repintan: el color sigue a la lista, no a su posición en el gráfico de hoy.
   */
  private readonly priceListOrder = computed(() => {
    const catalogue = this.priceLists().map((list) => list.uuid);
    const known = new Set(catalogue);
    const retired = [...new Set(this.changes().map((change) => change.priceListUuid))]
      .filter((uuid) => !known.has(uuid))
      .sort();

    return [...catalogue, ...retired];
  });

  private readonly chartData = computed(() =>
    buildPriceHistoryChart({
      changes: this.changes(),
      seeds: this.seeds(),
      from: this.from(),
      to: this.to(),
      now: this.loadedAt(),
      priceListOrder: this.priceListOrder(),
    }),
  );

  protected readonly xValues = computed(() => this.chartData().timestamps);

  protected readonly chartSeries = computed<LineChartSeries[]>(() => {
    const theme = this.theme.theme();
    const hidden = this.hiddenPriceLists();

    return this.chartData()
      .series.map((series) => ({ series, color: chartSeriesColor(series.order, theme) }))
      .filter((entry) => entry.color !== null)
      .map(({ series, color }) => ({
        key: series.priceListUuid,
        label: series.name,
        color: color as string,
        data: series.values,
        markers: series.markers,
        hidden: hidden.has(series.priceListUuid),
      }));
  });

  /**
   * La leyenda hace tres cosas: nombra cada curva —la identidad nunca queda sólo en el color—,
   * pone al lado el precio con el que cierra el período y su variación, y es el control que prende
   * y apaga la serie.
   */
  protected readonly legendRows = computed<PriceHistoryLegendRow[]>(() => {
    const theme = this.theme.theme();
    const hidden = this.hiddenPriceLists();

    return this.chartData().series.map((series) => {
      const delta =
        series.first !== null && series.last !== null ? round(series.last - series.first) : null;

      return {
        priceListUuid: series.priceListUuid,
        name: series.name,
        color: chartSeriesColor(series.order, theme),
        last: series.last,
        delta,
        deltaPercent:
          delta !== null && series.first ? round((delta / Math.abs(series.first)) * 100) : null,
        changeCount: series.changeCount,
        hidden: hidden.has(series.priceListUuid),
      };
    });
  });

  /** Listas con historial que no entran en la paleta: se listan en la tabla, no en el gráfico. */
  protected readonly unchartedNames = computed(() =>
    this.legendRows()
      .filter((row) => row.color === null)
      .map((row) => row.name),
  );

  protected readonly hasSeries = computed(() => this.chartSeries().length > 0);

  /** Cambios del período, del más nuevo al más viejo: es el orden en el que se lee un historial. */
  protected readonly tableRows = computed(() => {
    const hidden = this.hiddenPriceLists();

    return this.changes()
      .filter((change) => !hidden.has(change.priceListUuid))
      .slice()
      .sort((left, right) => right.timestamp - left.timestamp);
  });

  private readonly currencyFormatter = computed(
    () =>
      new Intl.NumberFormat(this.language.localeId(), {
        style: 'currency',
        currency: CHART_CURRENCY,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
  );

  /** El eje no necesita centavos: son marcas de referencia, no importes que se copien. */
  private readonly axisCurrencyFormatter = computed(
    () =>
      new Intl.NumberFormat(this.language.localeId(), {
        style: 'currency',
        currency: CHART_CURRENCY,
        maximumFractionDigits: 0,
      }),
  );

  private readonly axisDateFormatter = computed(() => {
    const spanDays = (this.to().getTime() - this.from().getTime()) / DAY_MS;
    const options: Intl.DateTimeFormatOptions =
      spanDays > LONG_WINDOW_DAYS
        ? { month: 'short', year: '2-digit' }
        : { day: '2-digit', month: 'short' };

    return new Intl.DateTimeFormat(this.language.localeId(), options);
  });

  private readonly tooltipDateFormatter = computed(
    () =>
      new Intl.DateTimeFormat(this.language.localeId(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
  );

  protected readonly formatValue = computed(() => {
    const formatter = this.currencyFormatter();
    return (value: number): string => formatter.format(value);
  });

  protected readonly formatAxisValue = computed(() => {
    const formatter = this.axisCurrencyFormatter();
    return (value: number): string => formatter.format(value);
  });

  protected readonly formatAxisDate = computed(() => {
    const formatter = this.axisDateFormatter();
    return (timestamp: number): string => formatter.format(new Date(timestamp));
  });

  protected readonly formatTooltipDate = computed(() => {
    const formatter = this.tooltipDateFormatter();
    return (timestamp: number): string => formatter.format(new Date(timestamp));
  });

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.products', link: PRODUCTS_PATH },
      this.productName()
        ? { label: this.productName(), link: productEditPath(this.productUuid) }
        : { labelKey: 'products.form.editTitle', link: productEditPath(this.productUuid) },
      { labelKey: 'products.priceHistory.title' },
    ]);

    // El calendario del datepicker sigue al idioma de la app, igual que el resto de las fechas.
    effect(() => this.dateAdapter.setLocale(this.language.localeId()));
  }

  ngOnInit(): void {
    if (!this.canViewPriceHistory) {
      this.loadState.set(LoadState.Success);
      return;
    }

    this.load();
  }

  protected onBack(): void {
    void this.router.navigate([productEditPath(this.productUuid)]);
  }

  protected onRetry(): void {
    this.load();
  }

  protected onPeriodChange(period: PriceHistoryPeriod): void {
    this.period.set(period);

    // «Personalizado» no mueve las fechas: es el modo en el que las pone el usuario.
    if (period === 'custom') {
      return;
    }

    const range = periodRange(period, new Date());
    this.from.set(range.from);
    this.to.set(range.to);
    this.reloadHistory();
  }

  protected onFromChange(date: Date | null): void {
    if (!date) {
      return;
    }

    this.from.set(date);
    this.period.set('custom');
    this.reloadHistory();
  }

  protected onToChange(date: Date | null): void {
    if (!date) {
      return;
    }

    this.to.set(date);
    this.period.set('custom');
    this.reloadHistory();
  }

  protected onBranchChange(branchUuid: string): void {
    this.branchUuid.set(branchUuid);
    this.reloadHistory();
  }

  protected isHidden(priceListUuid: string): boolean {
    return this.hiddenPriceLists().has(priceListUuid);
  }

  protected onToggleSeries(priceListUuid: string): void {
    this.hiddenPriceLists.update((hidden) => {
      const next = new Set(hidden);
      if (!next.delete(priceListUuid)) {
        next.add(priceListUuid);
      }
      return next;
    });
  }

  /** Clave de traducción del origen del cambio; los desconocidos se muestran tal cual vinieron. */
  protected sourceLabel(source: string | null): string {
    if (!source) {
      return '—';
    }

    const key = `products.priceHistory.sources.${source}`;
    const label = this.translate.instant(key);
    return label === key ? source : label;
  }

  /**
   * Catálogos y serie en una sola carga: sin las listas de precios no se puede fijar el color de
   * cada curva, y sin el producto no hay título. Un fallo del catálogo de listas no frena la
   * pantalla —el historial ya trae el nombre de cada lista—; el del producto sí, porque sin él la
   * ruta apunta a algo que no existe.
   */
  private load(): void {
    this.loadState.set(LoadState.Loading);
    const requestedAt = new Date();

    forkJoin({
      product: this.productsApi.getByUuid(this.productUuid),
      priceLists: this.productsApi.getPriceLists({ includeCost: true }).pipe(
        catchError(() => {
          this.toast.error(this.translate.instant('products.toasts.priceListsError'));
          return of([] as PriceListDto[]);
        }),
      ),
      changes: this.priceHistoryApi.listChanges(this.window()),
      seeds: this.priceHistoryApi.loadSeeds(this.seedWindow()),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.productName.set(data.product.name ?? '');
          this.priceLists.set(data.priceLists);
          this.applyHistory(data.changes.changes, data.changes.truncated, data.seeds, requestedAt);
          this.loadState.set(LoadState.Success);
        },
        error: () => {
          this.loadState.set(LoadState.Error);
        },
      });
  }

  /**
   * Recarga sólo la serie al cambiar un filtro. El gráfico anterior se queda en pantalla atenuado:
   * las fechas y la sucursal se tocan seguido, y vaciarlo en cada cambio haría saltar el layout.
   */
  private reloadHistory(): void {
    if (!this.canViewPriceHistory || this.invalidRange() || this.loadState() === LoadState.Error) {
      return;
    }

    this.refreshing.set(true);
    const requestedAt = new Date();

    forkJoin({
      changes: this.priceHistoryApi.listChanges(this.window()),
      seeds: this.priceHistoryApi.loadSeeds(this.seedWindow()),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.applyHistory(data.changes.changes, data.changes.truncated, data.seeds, requestedAt);
          this.refreshing.set(false);
        },
        error: () => {
          // El interceptor ya reporta el detalle; acá sólo se avisa que lo que se ve es lo anterior.
          this.toast.error(this.translate.instant('products.priceHistory.loadError'));
          this.refreshing.set(false);
        },
      });
  }

  private applyHistory(
    changes: readonly PriceChange[],
    truncated: boolean,
    seeds: ReadonlyMap<string, number>,
    requestedAt: Date,
  ): void {
    this.changes.set(changes);
    this.seeds.set(seeds);
    this.truncated.set(truncated);
    this.loadedAt.set(requestedAt);
  }

  private window() {
    return {
      productUuid: this.productUuid,
      branchUuid: this.branchUuid(),
      from: this.from(),
      to: this.to(),
    };
  }

  private seedWindow() {
    return {
      productUuid: this.productUuid,
      branchUuid: this.branchUuid(),
      from: this.from(),
    };
  }
}

/** Dos decimales: es la precisión con la que la pantalla muestra importes y porcentajes. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
