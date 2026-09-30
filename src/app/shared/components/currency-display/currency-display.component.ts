import { Component, computed, inject, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService } from '../../../core/i18n/language.service';

/**
 * How the amount is coloured.
 * - `neutral`: inherits the surrounding text colour (default).
 * - `auto`: green when positive, red when negative, neutral on zero.
 * - `positive` / `negative`: forced, for amounts whose meaning is not the sign
 *   (a discount is green even though it subtracts).
 */
export type CurrencyTone = 'neutral' | 'auto' | 'positive' | 'negative';

@Component({
  selector: 'app-currency-display',
  imports: [TranslatePipe],
  templateUrl: './currency-display.component.html',
  styleUrl: './currency-display.component.css',
})
export class CurrencyDisplayComponent {
  private readonly language = inject(LanguageService);

  readonly value = input<number | null | undefined>();

  /** ISO 4217 code. */
  readonly currency = input('ARS');

  readonly tone = input<CurrencyTone>('neutral');

  /** Prefixes a `+` on positive amounts (deltas, adjustments). */
  readonly showSign = input(false);

  readonly minimumFractionDigits = input(2);
  readonly maximumFractionDigits = input(2);

  /** Overrides the app locale (defaults to the active language). */
  readonly locale = input<string>();

  /** Text shown when there is no amount; defaults to the translated placeholder. */
  readonly emptyLabel = input<string>();

  protected readonly hasValue = computed(() => {
    const value = this.value();
    return typeof value === 'number' && Number.isFinite(value);
  });

  protected readonly resolvedTone = computed<CurrencyTone>(() => {
    const tone = this.tone();
    if (tone !== 'auto') {
      return tone;
    }

    const value = this.value() ?? 0;
    if (value > 0) {
      return 'positive';
    }

    return value < 0 ? 'negative' : 'neutral';
  });

  protected readonly formatted = computed(() => {
    const value = this.value();
    if (!this.hasValue()) {
      return '';
    }

    const amount = value as number;
    const formatter = new Intl.NumberFormat(this.locale() ?? this.language.localeId(), {
      style: 'currency',
      currency: this.currency(),
      minimumFractionDigits: this.minimumFractionDigits(),
      maximumFractionDigits: this.maximumFractionDigits(),
    });

    const text = formatter.format(amount);
    return this.showSign() && amount > 0 ? `+${text}` : text;
  });
}
