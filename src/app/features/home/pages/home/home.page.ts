import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { DashboardService, HomeSummary } from '../../../../core/dashboard/dashboard.service';
import { LanguageService } from '../../../../core/i18n/language.service';
import { PRODUCTS_PATH } from '../../../../core/product/product-page.paths';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NEW_COLLECTION_PATH } from '../../../checking-accounts/checking-accounts.paths';
import { NEW_PURCHASE_PATH } from '../../../purchases/purchases.paths';
import { POS_PATH, SALES_PATH } from '../../../sales/sales.paths';
import { EXPIRATIONS_PATH } from '../../../stock/stock.paths';

interface QuickAction {
  key: string;
  icon: string;
  link: string;
}

/**
 * Inicio de la Propuesta B: el total del mes como dato principal, cuatro indicadores chicos,
 * accesos rápidos y los avisos. Todo sale de `DashboardService`, que en la rama mock lee la base
 * local.
 */
@Component({
  selector: 'app-home-page',
  imports: [MatIconModule, RouterLink, TranslatePipe, PageHeaderComponent, CurrencyDisplayComponent],
  templateUrl: './home.page.html',
  styleUrl: './home.page.css',
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly dashboard = inject(DashboardService);
  private readonly language = inject(LanguageService);

  private readonly now = signal(new Date());

  protected readonly summary = toSignal<HomeSummary | null>(this.dashboard.summary(this.now()), {
    initialValue: null,
  });

  protected readonly userName = computed(() => this.auth.authUser()?.username ?? '');
  protected readonly branchName = computed(() => this.auth.selectedBranch()?.name ?? '');

  protected readonly today = computed(() => {
    const text = new Intl.DateTimeFormat(this.language.localeId(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(this.now());
    return text.charAt(0).toUpperCase() + text.slice(1);
  });

  protected readonly monthName = computed(() =>
    new Intl.DateTimeFormat(this.language.localeId(), { month: 'long' }).format(this.now()),
  );

  protected readonly lastMonthName = computed(() => {
    const date = new Date(this.now().getFullYear(), this.now().getMonth() - 1, 1);
    return new Intl.DateTimeFormat(this.language.localeId(), { month: 'long' }).format(date);
  });

  private readonly shortMonth = computed(() =>
    new Intl.DateTimeFormat(this.language.localeId(), { month: 'short' }).format(this.now()),
  );

  /** Barras de la tarjeta principal: alto relativo al pico, solo hasta hoy. */
  protected readonly bars = computed(() => {
    const month = this.summary()?.monthSales;
    if (!month) {
      return [];
    }
    const max = month.peak?.amount ?? 0;
    return month.bars.slice(0, this.now().getDate()).map((bar) => ({
      day: bar.day,
      on: bar.amount > 0,
      height: max > 0 && bar.amount > 0 ? Math.max(6, Math.round((bar.amount / max) * 100)) : 0,
    }));
  });

  protected readonly axis = computed(() => {
    const month = this.summary()?.monthSales;
    const short = this.shortMonth().replace('.', '');
    return {
      start: `1 ${short}`,
      peak: month?.peak ? `${month.peak.day} ${short}` : null,
      peakAmount: month?.peak?.amount ?? null,
      end: `${this.now().getDate()} ${short}`,
    };
  });

  protected readonly customerNames = computed(() => {
    const names = this.summary()?.customers.names ?? [];
    if (names.length <= 1) {
      return names.join('');
    }
    const shown = names.slice(0, 3);
    const rest = names.length - shown.length;
    return rest > 0
      ? `${shown.join(', ')} +${rest}`
      : `${shown.slice(0, -1).join(', ')} y ${shown[shown.length - 1]}`;
  });

  protected readonly actions: readonly QuickAction[] = [
    { key: 'sell', icon: 'point_of_sale', link: POS_PATH },
    { key: 'purchase', icon: 'add_shopping_cart', link: NEW_PURCHASE_PATH },
    { key: 'collection', icon: 'payments', link: NEW_COLLECTION_PATH },
    { key: 'product', icon: 'add_box', link: `${PRODUCTS_PATH}/new` },
  ];

  protected readonly salesPath = SALES_PATH;
  protected readonly productsPath = PRODUCTS_PATH;
  protected readonly expirationsPath = EXPIRATIONS_PATH;

  protected pillClass(tone: string): string {
    return tone === 'neutral' ? 'vk-pill vk-pill--dot' : `vk-pill vk-pill--dot vk-pill--${tone}`;
  }
}
