import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAttributeDto } from '../../data-access/employee-attribute.model';
import {
  EmployeeAttributeFormDialogComponent,
  EmployeeAttributeFormDialogData,
  EmployeeAttributeFormDialogResult,
} from './employee-attribute-form-dialog.component';

describe('EmployeeAttributeFormDialogComponent', () => {
  let fixture: ComponentFixture<EmployeeAttributeFormDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let data: EmployeeAttributeFormDialogData;

  const SIZE: EmployeeAttributeDto = {
    uuid: 'attr-size',
    name: 'Talle de uniforme',
    type: 'number',
    version: 3,
  };

  /** Acceso a los miembros `protected` que la plantilla usa. */
  const dialog = () =>
    fixture.componentInstance as unknown as {
      onTypeChange(type: string): void;
      attributeForm: {
        name: () => { value: { set(value: string): void; (): string } };
        type: () => { value: () => string };
      };
    };

  const render = (): void => {
    fixture = TestBed.createComponent(EmployeeAttributeFormDialogComponent);
    fixture.detectChanges();
  };

  const submit = (): void => {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  const closedWith = (): EmployeeAttributeFormDialogResult => close.mock.calls[0][0];

  beforeEach(async () => {
    close = vi.fn();
    data = { attribute: null };

    await TestBed.configureTestingModule({
      imports: [EmployeeAttributeFormDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        // Factory y no `useValue`: cada test define su `data` después de configurar el TestBed.
        { provide: MAT_DIALOG_DATA, useFactory: () => data },
      ],
    }).compileComponents();
  });

  it('creates a text field with the name trimmed', () => {
    render();

    dialog().attributeForm.name().value.set('  Obra social  ');
    fixture.detectChanges();
    submit();

    expect(closedWith()).toEqual({ uuid: undefined, name: 'Obra social', type: 'text' });
  });

  it('edits a field keeping its uuid and the version it was read with', () => {
    data = { attribute: SIZE };
    render();

    dialog().onTypeChange('decimal');
    fixture.detectChanges();
    submit();

    expect(closedWith()).toEqual({
      uuid: 'attr-size',
      name: 'Talle de uniforme',
      type: 'decimal',
      version: 3,
    });
  });

  it('reopens with what the user had typed when the save was rejected', () => {
    data = { attribute: SIZE, draft: { name: 'Talle', type: 'number' } };
    render();

    expect(dialog().attributeForm.name().value()).toBe('Talle');
    submit();

    expect(closedWith()).toEqual({ uuid: 'attr-size', name: 'Talle', type: 'number', version: 3 });
  });

  it('shows a type the front does not know as text', () => {
    data = { attribute: { ...SIZE, type: 'currency' } };
    render();

    expect(dialog().attributeForm.type().value()).toBe('text');
  });

  it('does not close without a name', () => {
    render();

    dialog().attributeForm.name().value.set('   ');
    fixture.detectChanges();
    submit();

    expect(close).not.toHaveBeenCalled();
  });
});
