import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenCashSessionDialogComponent,
  OpenCashSessionDialogResult,
} from './open-cash-session-dialog.component';

describe('OpenCashSessionDialogComponent', () => {
  let fixture: ComponentFixture<OpenCashSessionDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  /** Acceso al miembro `protected` que la plantilla enlaza. */
  const amountField = () =>
    (
      fixture.componentInstance as unknown as {
        openForm: {
          openingAmount: () => {
            value: { set(value: number | null): void };
            invalid: () => boolean;
          };
        };
      }
    ).openForm.openingAmount();

  const setAmount = (amount: number | null): void => {
    amountField().value.set(amount);
    fixture.detectChanges();
  };

  const submit = (): void => {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  const closedWith = (): OpenCashSessionDialogResult => close.mock.calls[0][0];

  beforeEach(async () => {
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [OpenCashSessionDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        { provide: MAT_DIALOG_DATA, useValue: { cashRegisterName: 'Caja 1' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OpenCashSessionDialogComponent);
    fixture.detectChanges();
  });

  /**
   * El caso corriente: una caja sin fondo fijo se abre en cero. `required` no puede leer ese cero
   * como «vacío», o abrir sin fondo sería imposible.
   */
  it('opens with zero without touching the field', () => {
    submit();

    expect(closedWith()).toEqual({ openingAmount: 0 });
  });

  it('closes with the amount that was typed', () => {
    setAmount(15250.5);
    submit();

    expect(closedWith()).toEqual({ openingAmount: 15250.5 });
  });

  /** No existe arrancar debiendo plata: el backend lo tomaría como fondo inicial negativo. */
  it('refuses a negative amount', () => {
    setAmount(-1);
    submit();

    expect(close).not.toHaveBeenCalled();
    expect(amountField().invalid()).toBe(true);
  });

  it('refuses an empty amount', () => {
    setAmount(null);
    submit();

    expect(close).not.toHaveBeenCalled();
    expect(amountField().invalid()).toBe(true);
  });
});
