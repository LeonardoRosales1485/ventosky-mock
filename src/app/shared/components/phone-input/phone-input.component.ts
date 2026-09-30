import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatFormFieldControl } from '@angular/material/form-field';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { PhoneCode, resolvePhoneCode, searchPhoneCodes } from '../../utils/phone-codes';
import {
  PhoneValue,
  createPhoneValue,
  digitsOf,
  emptyPhoneValue,
  formatNationalNumber,
  maxNationalDigits,
  nationalExample,
  parsePhoneNumber,
} from '../../utils/phone-number';

let nextUniqueId = 0;

/**
 * Phone number field: a searchable country selector plus a national number box,
 * bound to a single `PhoneValue`.
 *
 * The country is picked through an autocomplete, so the same input the user
 * reads the current country in also filters the list by name, ISO code or dial
 * code (`"arg"`, `"ar"` and `"+54"` all reach Argentina). The number box groups
 * digits following the country format and keeps the caret where the user left
 * it.
 *
 * It implements two contracts at once:
 *
 * - `MatFormFieldControl<PhoneValue>`, so it can be dropped inside a
 *   `<mat-form-field>` and reuse `<mat-label>`, `<mat-hint>` and `<mat-error>`
 *   (see https://material.angular.dev/guide/creating-a-custom-form-field-control).
 * - `FormValueControl<PhoneValue>` from `@angular/forms/signals`, so
 *   `[formField]` keeps `value` in sync and pushes `disabled` / `required` /
 *   `invalid` / `touched` in.
 *
 * The two contracts collide on `disabled` and `required`: Material reads them as
 * booleans while Signal Forms writes them as inputs. The inputs are therefore
 * declared under private names with a public alias, and the Material-facing
 * booleans are exposed as getters. That is also why the class cannot literally
 * `implements` either interface.
 *
 * ```html
 * <mat-form-field appearance="outline">
 *   <mat-label>Phone</mat-label>
 *   <app-phone-input [formField]="profileForm.phone" />
 *   <mat-error>{{ profileForm.phone().errors() | fieldError }}</mat-error>
 * </mat-form-field>
 * ```
 */
@Component({
  selector: 'app-phone-input',
  imports: [MatAutocompleteModule, TranslatePipe],
  templateUrl: './phone-input.component.html',
  styleUrl: './phone-input.component.css',
  providers: [{ provide: MatFormFieldControl, useExisting: PhoneInputComponent }],
  host: {
    '[attr.aria-disabled]': 'isDisabled() || null',
    '[class.phone-input--invalid]': 'errorState',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class PhoneInputComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Country preselected while the value carries no country of its own. */
  readonly defaultCountry = input('US');

  /** Accessible name of the number box. Defaults to a generic translated label. */
  readonly ariaLabel = input('');

  // --- Signal Forms contract (FormValueControl<PhoneValue>) ---

  readonly value = model<PhoneValue>(emptyPhoneValue());
  readonly invalid = input(false);
  readonly touched = input(false);
  /**
   * Bind as `disabled`; read through the `disabled` getter below. The alias is
   * required: `MatFormFieldControl` claims those names for plain properties.
   */
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly isDisabled = input(false, { alias: 'disabled' });
  /** Bind as `required`; read through the `required` getter below. */
  // eslint-disable-next-line @angular-eslint/no-input-rename
  readonly isRequired = input(false, { alias: 'required' });
  readonly touch = output<void>();

  // --- MatFormFieldControl<PhoneValue> contract ---

  readonly stateChanges = new Subject<void>();
  readonly id = `app-phone-input-${nextUniqueId++}`;
  readonly ngControl = null;
  readonly controlType = 'app-phone-input';

  protected readonly describedBy = signal('');
  private readonly isFocused = signal(false);

  get focused(): boolean {
    return this.isFocused();
  }

  get empty(): boolean {
    return this.value().nationalNumber.length === 0;
  }

  /** The country selector is always visible, so the label can never sit on top. */
  readonly shouldLabelFloat = true;

  /** Shown by `mat-form-field` when it needs a placeholder of its own. */
  get placeholder(): string {
    return nationalExample(this.country());
  }

  get required(): boolean {
    return this.isRequired();
  }

  get disabled(): boolean {
    return this.isDisabled();
  }

  get errorState(): boolean {
    return this.invalid() && this.touched();
  }

  get describedByIds(): string[] {
    return this.describedBy().split(' ').filter(Boolean);
  }

  private readonly numberInput = viewChild.required<ElementRef<HTMLInputElement>>('numberBox');

  /** Country of the current value, falling back to `defaultCountry`. */
  protected readonly country = computed(() =>
    resolvePhoneCode(this.value().iso2 || this.defaultCountry()),
  );

  protected readonly formattedNumber = computed(() =>
    formatNationalNumber(this.value().nationalNumber, this.country()),
  );

  /** Text typed in the country box; only meaningful while it has focus. */
  private readonly query = signal('');
  private readonly searching = signal(false);

  protected readonly countryText = computed(() =>
    this.searching() ? this.query() : this.displayCountry(this.country()),
  );

  protected readonly filteredCountries = computed(() => searchPhoneCodes(this.query()));

  constructor() {
    effect(() => {
      // Everything `mat-form-field` renders from; it re-checks on each emission.
      this.value();
      this.isDisabled();
      this.isRequired();
      this.invalid();
      this.touched();
      this.isFocused();
      this.stateChanges.next();
    });

    inject(DestroyRef).onDestroy(() => this.stateChanges.complete());
  }

  focus(options?: FocusOptions): void {
    this.numberInput().nativeElement.focus(options);
  }

  setDescribedByIds(ids: string[]): void {
    this.describedBy.set(ids.join(' '));
  }

  onContainerClick(): void {
    if (!this.isFocused()) {
      this.focus();
    }
  }

  /** Label of a country in the selector: `'🇦🇷 +54'`. */
  protected readonly displayCountry = (country: PhoneCode | null): string =>
    country ? `${country.emoji} ${country.phoneCode}` : '';

  // --- Country selector ---

  /** Selects the current country so the first keystroke starts a new search. */
  protected onCountryFocus(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  protected onCountryBlur(): void {
    this.searching.set(false);
    this.query.set('');
  }

  protected onCountryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.searching.set(true);
  }

  protected onCountrySelected(event: MatAutocompleteSelectedEvent): void {
    const selected = event.option.value as PhoneCode;

    this.searching.set(false);
    this.query.set('');
    this.value.set(createPhoneValue(selected.iso2, this.value().nationalNumber));

    // The country is rarely the last thing left to fill in, so focus moves on to
    // the number. It has to wait for the autocomplete, which puts focus back on
    // the country box right after this handler returns.
    queueMicrotask(() => this.numberInput().nativeElement.focus());
  }

  // --- Number box ---

  protected onNumberInput(event: Event): void {
    const element = event.target as HTMLInputElement;
    const caret = element.selectionStart ?? element.value.length;
    const digitsBeforeCaret = digitsOf(element.value.slice(0, caret)).length;

    this.commit(digitsOf(element.value));

    // Separators are added as the user types, so the caret has to be replaced by
    // digit count instead of by character offset.
    const formatted = this.formattedNumber();
    element.value = formatted;
    const position = caretAfterDigit(formatted, digitsBeforeCaret);
    element.setSelectionRange(position, position);
  }

  /**
   * Skips backwards over separators so `Backspace` deletes a digit rather than
   * the space the mask just inserted.
   */
  protected onNumberKeydown(event: KeyboardEvent): void {
    const element = event.target as HTMLInputElement;
    if (event.key !== 'Backspace' || element.selectionStart !== element.selectionEnd) {
      return;
    }

    let position = element.selectionStart ?? 0;
    while (position > 0 && !isDigit(element.value[position - 1])) {
      position--;
    }

    element.setSelectionRange(position, position);
  }

  /**
   * Adopts the country of a pasted international number. Anything else falls
   * through to the input handler, which keeps its digits.
   */
  protected onNumberPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!pasted.trim().startsWith('+') && !pasted.trim().startsWith('00')) {
      return;
    }

    event.preventDefault();
    this.value.set(parsePhoneNumber(pasted, this.country().iso2));

    const element = event.target as HTMLInputElement;
    element.value = this.formattedNumber();
    element.setSelectionRange(element.value.length, element.value.length);
  }

  // --- Focus tracking ---

  protected onFocusIn(): void {
    this.isFocused.set(true);
  }

  protected onFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && this.host.nativeElement.contains(nextTarget)) {
      return; // Focus only moved between the country box and the number box.
    }

    this.isFocused.set(false);
    this.touch.emit();
  }

  private commit(nationalNumber: string): void {
    const country = this.country();
    const digits = nationalNumber.slice(0, maxNationalDigits(country));
    const current = this.value();

    if (digits !== current.nationalNumber || country.iso2 !== current.iso2) {
      this.value.set(createPhoneValue(country.iso2, digits));
    }
  }
}

/** Offset right after the `count`-th digit of `formatted`. */
function caretAfterDigit(formatted: string, count: number): number {
  if (count <= 0) {
    return 0;
  }

  let seen = 0;
  for (let index = 0; index < formatted.length; index++) {
    if (isDigit(formatted[index]) && ++seen === count) {
      return index + 1;
    }
  }

  return formatted.length;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}
