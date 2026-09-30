import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatFormFieldModule } from '@angular/material/form-field';
import { form, FormField } from '@angular/forms/signals';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, beforeEach, expect, it } from 'vitest';
import { code } from '../../utils/signal-validators';
import { CodeInputComponent } from './code-input.component';

@Component({
  imports: [MatFormFieldModule, FormField, CodeInputComponent],
  template: `
    <mat-form-field>
      <mat-label>Code</mat-label>
      <app-code-input [formField]="testForm.code" [length]="4" ariaLabel="Code" />
    </mat-form-field>
  `,
})
class HostComponent {
  readonly model = signal({ code: '' });
  readonly testForm = form(this.model, (path) => {
    code(path.code, { length: 4 });
  });
  readonly codeInput = viewChild.required(CodeInputComponent);
}

describe('CodeInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const cells = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.code-input__cell'));

  const type = (index: number, text: string): void => {
    const cell = cells()[index];
    cell.value = text;
    cell.dispatchEvent(new Event('input'));
    fixture.detectChanges();
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

  it('renders one box per character', () => {
    expect(cells()).toHaveLength(4);
  });

  it('writes typed characters into the bound field and advances focus', () => {
    type(0, 'a');

    expect(host.model().code).toBe('A'); // uppercased by default
    expect(document.activeElement).toBe(cells()[1]);
  });

  it('rejects characters outside the charset and reverts the DOM', () => {
    type(0, '4');
    type(1, '/');

    expect(cells()[1].value).toBe('');
    expect(host.model().code).toBe('4');
  });

  it('spreads a pasted code over the boxes', () => {
    const event = new Event('paste') as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => '3fv2' },
    });
    cells()[0].dispatchEvent(event);
    fixture.detectChanges();

    expect(host.model().code).toBe('3FV2');
    expect(cells().map((cell) => cell.value)).toEqual(['3', 'F', 'V', '2']);
  });

  it('keeps the layout when a box in the middle is cleared', () => {
    type(0, '1');
    type(1, '2');
    type(2, '3');

    const backspace = new KeyboardEvent('keydown', { key: 'Backspace' });
    cells()[1].dispatchEvent(backspace);
    fixture.detectChanges();

    expect(host.model().code).toBe('13');
    expect(cells().map((cell) => cell.value)).toEqual(['1', '', '3', '']);
  });

  it('reflects the field state on the MatFormFieldControl contract', () => {
    const control = host.codeInput();

    expect(control.empty).toBe(true);
    expect(control.required).toBe(true); // `code()` applies `required`
    expect(control.errorState).toBe(false);

    host.testForm.code().markAsTouched();
    fixture.detectChanges();

    expect(control.errorState).toBe(true);

    type(0, '1');
    type(1, '2');
    type(2, '3');
    type(3, '4');

    expect(control.empty).toBe(false);
    expect(control.errorState).toBe(false);
  });
});
