import { HttpClient } from '@angular/common/http';
import { Service, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginationData } from '../paginate';

/** Un aviso de «Requiere atención»: lo comparten Inicio y la campana de la barra superior. */
export interface AttentionItem {
  tone: 'warn' | 'info' | 'bad' | 'neutral';
  /** Clave i18n de la etiqueta de la pill («Vence», «Stock», «Borrador»). */
  tagKey: string;
  title: string;
  /** Clave i18n del detalle y sus parámetros. */
  detailKey: string;
  detailParams?: Record<string, unknown>;
  link: string;
}

export interface CashStatus {
  open: boolean;
  name: string | null;
}

export interface DailyBar {
  day: number;
  amount: number;
}

export interface HomeSummary {
  monthSales: { total: number; count: number; average: number; bars: DailyBar[]; peak: DailyBar | null; daysInMonth: number };
  lastMonthPurchases: { total: number; count: number };
  products: { forSale: number; optimal: number };
  customers: { count: number; names: string[] };
  expiring: { count: number; first: string | null };
  attention: AttentionItem[];
}

interface OrderRow {
  uuid: string;
  publicId?: string | null;
  dateOperation?: string | null;
  voucher?: { code?: string | null; operationType?: string | null } | null;
  orderCheckout?: { totalAmount?: number | null } | null;
}

interface ProductRow {
  uuid: string;
  name: string;
  isForSale?: boolean | null;
  totalStock?: number | null;
  lowStock?: number | null;
  optimalStock?: number | null;
  status?: number | null;
}

interface CustomerRow {
  name?: string | null;
}

interface ExpirationRow {
  expirationStatus?: string | null;
  quantity?: number | null;
  batchNumber?: string | null;
  product?: { name?: string | null } | null;
  warehouse?: { name?: string | null } | null;
}

interface EntryContext {
  cashRegister?: { name?: string | null; openSession?: { sessionState?: string | null } | null } | null;
}

const PAGE = { page: 1, size: 500 };

/**
 * Los números de Inicio y los avisos de la campana. No hay endpoint de agregados: se arman en el
 * front con los listados que ya existen (órdenes, productos, clientes, vencimientos), que en la
 * rama mock salen de la base local.
 */
@Service()
export class DashboardService {
  private readonly http = inject(HttpClient);

  readonly cash = signal<CashStatus | null>(null);
  readonly attention = signal<AttentionItem[]>([]);

  /** Lo que la barra superior necesita: la caja y los avisos. */
  refreshShell(): void {
    this.http
      .get<EntryContext>(apiUrl(API_ENDPOINTS.CASH_REGISTERS.ENTRY_CONTEXT))
      .pipe(catchError(() => of(null)))
      .subscribe((context) => {
        const register = context?.cashRegister;
        this.cash.set(
          register
            ? { open: register.openSession?.sessionState === 'OPEN', name: register.name ?? null }
            : null,
        );
      });

    this.summary().subscribe();
  }

  summary(now: Date = new Date()): Observable<HomeSummary> {
    return forkJoin({
      orders: this.page<OrderRow>(API_ENDPOINTS.ORDERS.PAGINATE),
      products: this.page<ProductRow>(API_ENDPOINTS.PRODUCTS.PAGINATE),
      customers: this.page<CustomerRow>(API_ENDPOINTS.CUSTOMERS.PAGINATE),
      expirations: this.http
        .get<{ rows?: ExpirationRow[] }>(apiUrl(API_ENDPOINTS.STOCK.EXPIRATIONS), {
          params: { page: 0, size: 50 },
        })
        .pipe(
          map((page) => page.rows ?? []),
          catchError(() => of([] as ExpirationRow[])),
        ),
    }).pipe(
      map(({ orders, products, customers, expirations }) =>
        buildSummary(orders, products, customers, expirations, now),
      ),
      tap((summary) => this.attention.set(summary.attention)),
    );
  }

  private page<T>(endpoint: string): Observable<T[]> {
    return this.http.post<PaginationData<T>>(apiUrl(endpoint), PAGE).pipe(
      map((page) => page.content ?? []),
      catchError(() => of([] as T[])),
    );
  }
}

function amountOf(order: OrderRow): number {
  return Number(order.orderCheckout?.totalAmount ?? 0);
}

function buildSummary(
  orders: OrderRow[],
  products: ProductRow[],
  customers: CustomerRow[],
  expirations: ExpirationRow[],
  now: Date,
): HomeSummary {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lastMonth = new Date(year, month - 1, 1);

  const dated = orders.map((order) => ({ order, date: order.dateOperation ? new Date(order.dateOperation) : null }));
  const isSale = (o: OrderRow) => o.voucher?.operationType === 'SALE' && !/ORDER|QUOTE/.test(o.voucher?.code ?? '');
  const isPurchase = (o: OrderRow) =>
    o.voucher?.operationType === 'PURCHASE' && !/ORDER|QUOTE|CREDIT/.test(o.voucher?.code ?? '');

  const sales = dated.filter(({ order, date }) => isSale(order) && date?.getFullYear() === year && date.getMonth() === month);
  const total = sales.reduce((sum, { order }) => sum + amountOf(order), 0);
  const bars: DailyBar[] = Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, amount: 0 }));
  for (const { order, date } of sales) {
    bars[date!.getDate() - 1].amount += amountOf(order);
  }
  const peak = bars.reduce<DailyBar | null>((best, bar) => (bar.amount > (best?.amount ?? 0) ? bar : best), null);

  const purchases = dated.filter(
    ({ order, date }) =>
      isPurchase(order) && date?.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth(),
  );

  const live = products.filter((p) => p.status !== -1);
  const forSale = live.filter((p) => p.isForSale !== false);
  const optimal = forSale.filter(
    (p) => p.optimalStock != null && Number(p.totalStock ?? 0) >= Number(p.optimalStock),
  );
  const withoutThresholds = forSale.filter((p) => p.lowStock == null && p.optimalStock == null);

  const expiring = expirations.filter((row) => row.expirationStatus && row.expirationStatus !== 'OK');

  const attention: AttentionItem[] = [
    ...expiring.slice(0, 3).map<AttentionItem>((row) => ({
      tone: row.expirationStatus === 'EXPIRED' ? 'bad' : 'warn',
      tagKey: row.expirationStatus === 'EXPIRED' ? 'dashboard.attention.expired' : 'dashboard.attention.expires',
      title: row.product?.name ?? row.batchNumber ?? '—',
      detailKey: 'dashboard.attention.expiresDetail',
      detailParams: { quantity: row.quantity ?? 0, warehouse: row.warehouse?.name ?? '' },
      link: '/panel/stock/expirations',
    })),
    ...withoutThresholds.slice(0, 2).map<AttentionItem>((product) => ({
      tone: 'info',
      tagKey: 'dashboard.attention.stock',
      title: product.name,
      detailKey: 'dashboard.attention.noThresholds',
      link: `/panel/products/${product.uuid}/edit`,
    })),
    ...orders
      .filter((o) => o.voucher?.code === 'PURCHASE_ORDER')
      .slice(0, 2)
      .map<AttentionItem>((order) => ({
        tone: 'neutral',
        tagKey: 'dashboard.attention.draft',
        title: `#${order.publicId ?? ''}`,
        detailKey: 'dashboard.attention.draftDetail',
        detailParams: { date: order.dateOperation ? new Date(order.dateOperation).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' }) : '' },
        link: `/panel/purchases/${order.uuid}/edit`,
      })),
  ];

  return {
    monthSales: {
      total,
      count: sales.length,
      average: sales.length ? total / sales.length : 0,
      bars,
      peak,
      daysInMonth,
    },
    lastMonthPurchases: {
      total: purchases.reduce((sum, { order }) => sum + amountOf(order), 0),
      count: purchases.length,
    },
    products: { forSale: forSale.length, optimal: optimal.length },
    customers: {
      count: customers.length,
      names: customers.map((c) => c.name ?? '').filter(Boolean),
    },
    expiring: { count: expiring.length, first: expiring[0]?.product?.name ?? null },
    attention,
  };
}
