import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductSerialsDto } from '../stock-serial.model';
import { StockSerialsApiService } from '../stock-serials-api.service';
import {
  SerialPickerDialogComponent,
  SerialPickerDialogData,
} from './serial-picker-dialog.component';

const WAREHOUSE = { uuid: 'wh-1', name: 'Depósito Principal' };

const SERIALS: ProductSerialsDto = {
  product: { uuid: 'product-1', name: 'Notebook Aureo 14"' },
  allBranches: false,
  inStockCount: 2,
  soldCount: 1,
  returnedCount: 0,
  inTransitCount: 0,
  scrappedCount: 0,
  balanceQuantity: 2,
  consistent: true,
  rows: [
    {
      uuid: 's-41',
      serialNumber: 'SN-0041',
      state: 'IN_STOCK',
      warehouse: WAREHOUSE,
      batchNumber: 'L-7',
    },
    { uuid: 's-42', serialNumber: 'SN-0042', state: 'SOLD' },
    { uuid: 's-43', serialNumber: 'SN-0043', state: 'IN_STOCK', warehouse: WAREHOUSE },
  ],
};

const DATA: SerialPickerDialogData = {
  product: { uuid: 'product-1', name: 'Notebook Aureo 14"' },
  quantity: 1,
  current: [],
};

describe('SerialPickerDialogComponent', () => {
  let fixture: ComponentFixture<SerialPickerDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const checkboxes = (): HTMLInputElement[] =>
    Array.from(element().querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const confirmButton = (): HTMLButtonElement =>
    element().querySelector('mat-dialog-actions button[mat-flat-button]') as HTMLButtonElement;

  beforeEach(async () => {
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SerialPickerDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: { close } },
        { provide: StockSerialsApiService, useValue: { getProductSerials: () => of(SERIALS) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SerialPickerDialogComponent);
    fixture.detectChanges();
  });

  /**
   * Cada unidad disponible es una casilla, y la unidad —su número y dónde está— es la etiqueta de
   * esa casilla: es lo que se lee al llegar a ella. Sin un `<label>` dentro de otro.
   */
  it('labels the checkbox of each available unit with the unit itself', () => {
    const inputs = checkboxes();

    expect(inputs).toHaveLength(2);
    expect(inputs[0].labels?.[0]?.textContent).toContain('SN-0041');
    expect(inputs[0].labels?.[0]?.textContent).toContain('Depósito Principal');
    expect(inputs[1].labels?.[0]?.textContent).toContain('SN-0043');
    expect(element().querySelector('label label')).toBeNull();
  });

  /** Tocar la unidad, y no sólo la casilla, la elige. Una vez: no se tilda y se destilda en el mismo toque. */
  it('selects a unit by clicking its text', () => {
    element().querySelector<HTMLElement>('.picker__row-title')?.click();
    fixture.detectChanges();

    expect(checkboxes()[0].checked).toBe(true);
    confirmButton().click();
    expect(close).toHaveBeenCalledWith(['SN-0041']);
  });

  it('selects a unit by clicking its checkbox', () => {
    checkboxes()[1].click();
    fixture.detectChanges();

    confirmButton().click();
    expect(close).toHaveBeenCalledWith(['SN-0043']);
  });
});
