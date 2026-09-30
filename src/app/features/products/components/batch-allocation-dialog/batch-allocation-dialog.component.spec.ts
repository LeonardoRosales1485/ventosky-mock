import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BatchAllocationDialogComponent,
  BatchAllocationDialogData,
  BatchAllocationDialogResult,
} from './batch-allocation-dialog.component';

describe('BatchAllocationDialogComponent', () => {
  let fixture: ComponentFixture<BatchAllocationDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let data: BatchAllocationDialogData;

  const BATCHES = [
    { uuid: 'batch-1', batchNumber: 'ADJ-1a2b', quantity: 80, expirationDate: null, unitCost: 100 },
    { uuid: 'batch-2', batchNumber: 'UNICO', quantity: 40, expirationDate: null, unitCost: 120 },
  ];

  /** Un ingreso de 30 sobre un depósito con 120 repartidos en dos lotes. */
  const INGRESO: BatchAllocationDialogData = {
    productName: 'Galaxy S23',
    warehouseName: 'Depósito Principal',
    direction: 'INGRESO',
    delta: 30,
    currentQuantity: 120,
    batches: BATCHES,
    unitDecimalPlaces: 0,
  };

  const render = (): void => {
    fixture = TestBed.createComponent(BatchAllocationDialogComponent);
    fixture.detectChanges();
  };

  /** Los inputs de cantidad de cada lote, en el orden en que llegaron del `412`. */
  const quantityInputs = (): HTMLInputElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.batch-allocation__quantity input'));

  const confirmButton = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('mat-dialog-actions button:last-of-type');

  const type = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const closedWith = (): BatchAllocationDialogResult => close.mock.calls[0][0];

  beforeEach(async () => {
    close = vi.fn();
    data = INGRESO;

    await TestBed.configureTestingModule({
      imports: [BatchAllocationDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        // Factory y no `useValue`: cada test define su `data` después de configurar el TestBed.
        { provide: MAT_DIALOG_DATA, useFactory: () => data },
      ],
    }).compileComponents();
  });

  /**
   * El backend rechaza el reparto que no suma la diferencia, así que el botón no deja intentarlo:
   * repartir de menos dejaría el depósito en una cantidad que el operador no pidió.
   */
  it('only confirms once the split adds up to the difference', () => {
    render();

    expect(confirmButton().disabled).toBe(true);

    type(quantityInputs()[0], '12');
    expect(confirmButton().disabled).toBe(true);

    type(quantityInputs()[1], '18');
    expect(confirmButton().disabled).toBe(false);
  });

  it('refuses a split that overshoots the difference', () => {
    render();

    type(quantityInputs()[0], '20');
    type(quantityInputs()[1], '20');

    expect(confirmButton().disabled).toBe(true);
  });

  it('sends one allocation per batch that got a quantity', () => {
    render();

    type(quantityInputs()[0], '30');
    confirmButton().click();

    // El lote que quedó vacío no viaja: una línea en cero no es un reparto.
    expect(closedWith()).toEqual([{ stockBatch: { uuid: 'batch-1' }, quantity: 30 }]);
  });

  /** El atajo de la fila: imputarle lo que falta sin tener que hacer la resta a mano. */
  it('fills the remainder into the batch that asks for it', () => {
    render();

    type(quantityInputs()[0], '10');
    const fill: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.batch-allocation__quantity button',
    );
    fill.click();
    fixture.detectChanges();

    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    expect(closedWith()).toEqual([{ stockBatch: { uuid: 'batch-1' }, quantity: 30 }]);
  });

  describe('egreso', () => {
    beforeEach(() => {
      data = { ...INGRESO, direction: 'EGRESO', delta: -30 };
    });

    /** El `412 ADJUSTMENT_BATCH_INSUFFICIENT` se evita acá en vez de esperar a que el backend lo tire. */
    it('blocks a batch asked for more than it holds', () => {
      render();

      type(quantityInputs()[1], '50');

      expect(confirmButton().disabled).toBe(true);
      expect(fixture.nativeElement.querySelector('.batch-allocation__error')).not.toBeNull();
    });

    /** `newBatch` sólo vale en un ingreso: no se descuenta de una partida que no existe. */
    it('does not offer to open a new batch', () => {
      render();

      expect(fixture.nativeElement.querySelector('.batch-allocation__new')).toBeNull();
    });
  });

  describe('partida nueva', () => {
    it('adds the new batch with its own cost and expiration', () => {
      render();

      type(quantityInputs()[0], '10');

      const toggle: HTMLInputElement = fixture.nativeElement.querySelector(
        '.batch-allocation__new input[type="checkbox"]',
      );
      toggle.click();
      fixture.detectChanges();

      const [quantity, cost, expiration] = Array.from(
        fixture.nativeElement.querySelectorAll('.batch-allocation__new-fields input'),
      ) as HTMLInputElement[];

      type(quantity, '20');
      type(cost, '250');
      type(expiration, '2027-03-01');

      confirmButton().click();

      expect(closedWith()).toEqual([
        { stockBatch: { uuid: 'batch-1' }, quantity: 10 },
        { newBatch: true, quantity: 20, unitCost: 250, expirationDate: '2027-03-01' },
      ]);
    });
  });

  /** La unidad discreta no admite medias unidades, la misma vara que aplica el backend. */
  it('rejects a quantity finer than the unit allows', () => {
    render();

    type(quantityInputs()[0], '30.5');

    expect(confirmButton().disabled).toBe(true);
  });
});
