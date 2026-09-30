import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, beforeEach, expect, it } from 'vitest';
import { CurrencyDisplayComponent } from './currency-display.component';

describe('CurrencyDisplayComponent', () => {
  let fixture: ComponentFixture<CurrencyDisplayComponent>;

  const amount = (): HTMLElement => fixture.nativeElement.querySelector('.currency-display');

  /** Intl separa el símbolo con espacios duros; los normalizamos para poder comparar. */
  const amountText = (): string => amount().textContent!.replace(/\s+/g, ' ').trim();

  const render = (inputs: Record<string, unknown>): void => {
    Object.entries(inputs).forEach(([key, value]) => fixture.componentRef.setInput(key, value));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CurrencyDisplayComponent],
      providers: [provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(CurrencyDisplayComponent);
  });

  it('formats the amount as currency for the given locale', () => {
    render({ value: 1234.5, currency: 'ARS', locale: 'es-AR' });

    // En es-AR el separador de miles es un punto y el decimal una coma.
    expect(amountText()).toBe('$ 1.234,50');
  });

  it('is neutral by default even for negative amounts', () => {
    render({ value: -10, locale: 'es-AR' });

    expect(amount().classList.contains('currency-display--negative')).toBe(false);
    expect(amount().classList.contains('currency-display--positive')).toBe(false);
  });

  it('colours by sign with tone="auto"', () => {
    render({ value: 10, tone: 'auto', locale: 'es-AR' });
    expect(amount().classList.contains('currency-display--positive')).toBe(true);

    render({ value: -10 });
    expect(amount().classList.contains('currency-display--negative')).toBe(true);

    render({ value: 0 });
    expect(amount().classList.contains('currency-display--positive')).toBe(false);
    expect(amount().classList.contains('currency-display--negative')).toBe(false);
  });

  it('forces the tone regardless of the sign', () => {
    render({ value: -250, tone: 'positive', locale: 'es-AR' });

    expect(amount().classList.contains('currency-display--positive')).toBe(true);
  });

  it('prefixes a plus sign on positive amounts when asked', () => {
    render({ value: 10, showSign: true, locale: 'es-AR' });

    expect(amountText().startsWith('+')).toBe(true);
  });

  it('renders the empty placeholder when there is no amount', () => {
    render({ value: null, emptyLabel: 'Sin precio' });

    expect(amount().classList.contains('currency-display--empty')).toBe(true);
    expect(amountText()).toBe('Sin precio');
  });
});
