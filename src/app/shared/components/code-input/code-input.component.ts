import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { MatFormFieldControl } from '@angular/material/form-field';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { CODE_CHARSET_CHARS, CodeCharset } from '../../utils/signal-validators';

let nextUniqueId = 0;

/**
 * OTP-style input: one box per character, bound to a single string value
 * (`"453"`, `"3FV2"`, `"32VF43VF"`, …).
 *
 * It implements two contracts at once:
 *
 * - `MatFormFieldControl<string>`, so it can be dropped inside a `<mat-form-field>`
 *   and reuse `<mat-label>`, `<mat-hint>` and `<mat-error>`
 *   (see https://material.angular.dev/guide/creating-a-custom-form-field-control).
 * - `FormValueControl<string>` from `@angular/forms/signals`, so `[formField]`
 *   keeps `value` in sync and pushes `disabled` / `required` / `invalid` / `touched` in.
 *
 * The two contracts collide on `disabled` and `required`: Material reads them as
 * booleans while Signal Forms writes them as inputs. The inputs are therefore
 * declared under private names with a public alias, and the Material-facing
 * booleans are exposed as getters. That is also why the class cannot literally
 * `implements` either interface.
 */
@Component({
  selector: 'app-code-input',
  imports: [TranslatePipe],
  templateUrl: './code-input.component.html',
  styleUrl: './code-input.component.css',
  providers: [{ provide: MatFormFieldControl, useExisting: CodeInputComponent }],
  host: {
    role: 'group',
    '[attr.aria-label]': 'ariaLabel() || null',
    '[attr.aria-describedby]': 'describedBy() || null',
    '[attr.aria-disabled]': 'isDisabled() || null',
    '[class.code-input--invalid]': 'errorState',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class CodeInputComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Number of characters the code has. */
  readonly length = input(6, { transform: (value: number) => Math.max(1, Math.trunc(value)) });

  /** Accepted characters. Also drives the mobile keyboard shown for each box. */
  readonly charset = input<CodeCharset>('alphanumeric');

  /** Uppercases typed letters. Ignored when `charset` is `numeric`. */
  readonly uppercase = input(true);

  /** Accessible name of the group of boxes. */
  readonly ariaLabel = input('');

  // --- Signal Forms contract (FormValueControl<string>) ---

  readonly value = model('');
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

  // --- MatFormFieldControl<string> contract ---

  readonly stateChanges = new Subject<void>();
  readonly id = `app-code-input-${nextUniqueId++}`;
  readonly placeholder = '';
  readonly ngControl = null;
  readonly controlType = 'app-code-input';
  /** The value spans several inputs, so a single `for` attribute cannot label it. */
  readonly disableAutomaticLabeling = true;

  protected readonly describedBy = signal('');
  private readonly isFocused = signal(false);

  get focused(): boolean {
    return this.isFocused();
  }

  get empty(): boolean {
    return this.value().length === 0;
  }

  /** The boxes are always visible, so the label can never sit on top of them. */
  readonly shouldLabelFloat = true;

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

  private readonly cellInputs = viewChildren<ElementRef<HTMLInputElement>>('cell');

  /**
   * One entry per box. Holds the layout rather than deriving it from `value` on
   * every read, so clearing a box in the middle does not shift the rest left.
   */
  protected readonly cells = linkedSignal<string, string[]>({
    source: this.value,
    computation: (value, previous) => {
      if (previous && previous.value.join('') === value) {
        return previous.value; // Same code, keep the gaps where the user left them.
      }

      return toCells(value, this.length());
    },
  });

  protected readonly inputMode = computed(() =>
    this.charset() === 'numeric' ? 'numeric' : 'text',
  );

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

  /** Moves focus to the first empty box, or to the last one when the code is complete. */
  focus(options?: FocusOptions): void {
    this.focusCell(this.firstEmptyIndex(), options);
  }

  reset(): void {
    this.commit(toCells('', this.length()));
  }

  setDescribedByIds(ids: string[]): void {
    this.describedBy.set(ids.join(' '));
  }

  onContainerClick(): void {
    if (!this.isFocused()) {
      this.focus();
    }
  }

  protected onCellInput(event: Event, index: number): void {
    const element = event.target as HTMLInputElement;
    const typed = this.sanitize(element.value);

    // Autofill and IME composition can deliver the whole code into one box.
    if (typed.length > 1) {
      element.value = typed[0] ?? '';
      this.writeFrom(index, typed);
      return;
    }

    // Rejected characters never reach the model, so the DOM has to be reverted here.
    element.value = typed;
    this.setCellAt(index, typed);

    if (typed) {
      this.focusCell(index + 1);
    }
  }

  protected onCellKeydown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case 'Backspace':
        if (this.cells()[index]) {
          this.setCellAt(index, '');
        } else if (index > 0) {
          this.setCellAt(index - 1, '');
          this.focusCell(index - 1);
        }
        break;
      case 'Delete':
        this.setCellAt(index, '');
        break;
      case 'ArrowLeft':
        this.focusCell(index - 1);
        break;
      case 'ArrowRight':
        this.focusCell(index + 1);
        break;
      case 'Home':
        this.focusCell(0);
        break;
      case 'End':
        this.focusCell(this.length() - 1);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  protected onCellPaste(event: ClipboardEvent, index: number): void {
    event.preventDefault();

    const pasted = this.sanitize(event.clipboardData?.getData('text') ?? '');
    if (pasted) {
      this.writeFrom(index, pasted);
    }
  }

  /** Selecting on focus lets the next keystroke overwrite a filled box. */
  protected onCellFocus(index: number): void {
    this.cellInputs()[index]?.nativeElement.select();
  }

  protected onFocusIn(): void {
    this.isFocused.set(true);
  }

  protected onFocusOut(event: FocusEvent): void {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && this.host.nativeElement.contains(nextTarget)) {
      return; // Focus only moved between boxes.
    }

    this.isFocused.set(false);
    this.touch.emit();
  }

  private sanitize(raw: string): string {
    const charset = this.charset();
    const allowed = CODE_CHARSET_CHARS[charset];
    const cleaned = [...raw].filter((char) => allowed.test(char)).join('');

    return charset === 'alphanumeric' && this.uppercase() ? cleaned.toUpperCase() : cleaned;
  }

  private setCellAt(index: number, char: string): void {
    const cells = [...this.cells()];
    cells[index] = char;
    this.commit(cells);
  }

  /** Spreads `chars` over consecutive boxes starting at `index`. */
  private writeFrom(index: number, chars: string): void {
    const cells = [...this.cells()];
    let cursor = index;

    for (const char of chars) {
      if (cursor >= cells.length) {
        break;
      }
      cells[cursor++] = char;
    }

    this.commit(cells);
    this.focusCell(cursor);
  }

  private commit(cells: string[]): void {
    this.cells.set(cells);

    const next = cells.join('');
    if (next !== this.value()) {
      this.value.set(next);
    }
  }

  private focusCell(index: number, options?: FocusOptions): void {
    const inputs = this.cellInputs();
    if (inputs.length === 0) {
      return;
    }

    const clamped = Math.min(Math.max(index, 0), inputs.length - 1);
    inputs[clamped].nativeElement.focus(options);
  }

  private firstEmptyIndex(): number {
    const cells = this.cells();
    const index = cells.indexOf('');

    return index === -1 ? cells.length - 1 : index;
  }
}

function toCells(value: string, length: number): string[] {
  return Array.from({ length }, (_, index) => value[index] ?? '');
}
