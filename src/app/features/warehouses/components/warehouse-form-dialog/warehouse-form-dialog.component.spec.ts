import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import {
  WarehouseFormDialogComponent,
  WarehouseFormDialogData,
  WarehouseFormDialogResult,
} from './warehouse-form-dialog.component';

describe('WarehouseFormDialogComponent', () => {
  let fixture: ComponentFixture<WarehouseFormDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let data: WarehouseFormDialogData;

  const WAREHOUSE: WarehouseDto = { uuid: 'wh-1', name: 'Depósito central', priority: 2 };

  /** Un campo del formulario, con lo justo para escribirlo desde el test. */
  type Field<T> = () => { value: { set(value: T): void } };

  /** Acceso a los miembros `protected` que la plantilla usa. */
  const dialog = () =>
    fixture.componentInstance as unknown as {
      warehouseForm: { name: Field<string>; priority: Field<number | null> };
    };

  const render = (): void => {
    fixture = TestBed.createComponent(WarehouseFormDialogComponent);
    fixture.detectChanges();
  };

  const submit = (): void => {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  const closedWith = (): WarehouseFormDialogResult => close.mock.calls[0][0];

  beforeEach(async () => {
    close = vi.fn();
    data = { warehouse: null };

    await TestBed.configureTestingModule({
      imports: [WarehouseFormDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        // Factory y no `useValue`: cada test define su `data` después de configurar el TestBed.
        { provide: MAT_DIALOG_DATA, useFactory: () => data },
      ],
    }).compileComponents();
  });

  it('creates a warehouse with no priority so the backend puts it last', () => {
    render();

    dialog().warehouseForm.name().value.set('  Depósito norte  ');
    fixture.detectChanges();
    submit();

    expect(closedWith()).toEqual({
      uuid: undefined,
      name: 'Depósito norte',
      priority: null,
    });
  });

  it('preloads the warehouse being edited and keeps its uuid', () => {
    data = { warehouse: WAREHOUSE };
    render();

    submit();

    expect(closedWith()).toEqual({
      uuid: 'wh-1',
      name: 'Depósito central',
      priority: 2,
    });
  });

  it('does not submit a warehouse without a name', () => {
    render();

    dialog().warehouseForm.name().value.set('   ');
    fixture.detectChanges();
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('does not submit a priority below the first position', () => {
    render();

    dialog().warehouseForm.name().value.set('Depósito norte');
    dialog().warehouseForm.priority().value.set(0);
    fixture.detectChanges();
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('does not submit a fractional priority', () => {
    render();

    dialog().warehouseForm.name().value.set('Depósito norte');
    dialog().warehouseForm.priority().value.set(1.5);
    fixture.detectChanges();
    submit();

    expect(close).not.toHaveBeenCalled();
  });
});
