import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatFormFieldModule } from '@angular/material/form-field';
import { form, FormField } from '@angular/forms/signals';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, beforeEach, expect, it } from 'vitest';
import { emptyPhoneValue } from '../../utils/phone-number';
import { phoneNumber } from '../../utils/signal-validators';
import { PhoneInputComponent } from './phone-input.component';

@Component({
  imports: [MatFormFieldModule, FormField, PhoneInputComponent],
  template: `
    <mat-form-field>
      <mat-label>Phone</mat-label>
      <app-phone-input [formField]="testForm.phone" defaultCountry="AR" />
    </mat-form-field>
  `,
})
class HostComponent {
  readonly model = signal({ phone: emptyPhoneValue('AR') });
  readonly testForm = form(this.model, (path) => {
    phoneNumber(path.phone);
  });
  readonly phoneInput = viewChild.required(PhoneInputComponent);
}

describe('PhoneInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const countryBox = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('.phone-input__country');

  const numberBox = (): HTMLInputElement =>
    fixture.nativeElement.querySelector('.phone-input__number');

  const options = (): HTMLElement[] =>
    Array.from(document.querySelectorAll('mat-option')) as HTMLElement[];

  const type = (element: HTMLInputElement, text: string): void => {
    element.value = text;
    element.setSelectionRange(text.length, text.length);
    element.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const search = (text: string): void => {
    countryBox().focus();
    type(countryBox(), text);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows the flag and dial code of the preselected country', () => {
    expect(countryBox().value).toBe('🇦🇷 +54');
  });

  it('keeps only digits and groups them the way the country formats them', () => {
    type(numberBox(), '11a1234-5678');

    expect(numberBox().value).toBe('11 1234 5678');
    expect(host.model().phone.nationalNumber).toBe('1112345678');
    expect(host.model().phone.e164).toBe('+541112345678');
  });

  it('leaves the caret after the digit that was just typed', () => {
    type(numberBox(), '111');

    expect(numberBox().value).toBe('11 1');
    expect(numberBox().selectionStart).toBe(4);
  });

  it('filters the country list by name, ISO code and dial code', () => {
    search('spa');
    expect(options().map((option) => option.textContent?.trim())).toHaveLength(1);

    search('+34');
    expect(options()).toHaveLength(1);

    search('zzz');
    expect(options()[0].textContent).toContain('phoneInput.noResults');
  });

  it('switches country without losing the typed number, then moves on to it', async () => {
    type(numberBox(), '1112345678');
    search('spain');
    options()[0].click();
    await Promise.resolve(); // Focus moves to the number box on a microtask.
    fixture.detectChanges();

    expect(host.model().phone.iso2).toBe('ES');
    expect(host.model().phone.e164).toBe('+341112345678');
    expect(countryBox().value).toBe('🇪🇸 +34');
    expect(document.activeElement).toBe(numberBox());
  });

  it('adopts the country of a pasted international number', () => {
    const event = new Event('paste') as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => '+44 20 7946 0958' },
    });
    numberBox().dispatchEvent(event);
    fixture.detectChanges();

    expect(host.model().phone.iso2).toBe('GB');
    expect(host.model().phone.nationalNumber).toBe('2079460958');
    expect(numberBox().value).toBe('20 7946 0958');
  });

  it('reports a required error while the number is empty', () => {
    expect(host.testForm.phone().errors()[0]?.kind).toBe('required');

    type(numberBox(), '1112345678');
    expect(host.testForm.phone().errors()).toHaveLength(0);
  });

  it('reports an invalid number when it is too short', () => {
    type(numberBox(), '11');

    expect(host.testForm.phone().errors()[0]?.kind).toBe('phoneNumber');
  });
});
