import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, apiUrl } from '../../../../core/http/api.config';
import { CategoryTreeNode } from '../../data-access/category.model';
import {
  CategoryFormDialogComponent,
  CategoryFormDialogResult,
} from './category-form-dialog.component';

describe('CategoryFormDialogComponent', () => {
  let fixture: ComponentFixture<CategoryFormDialogComponent>;
  let http: HttpTestingController;
  let close: ReturnType<typeof vi.fn>;
  let data: { category: CategoryTreeNode | null; parent: CategoryTreeNode | null };

  const CATEGORY: CategoryTreeNode = {
    uuid: 'cat-1',
    name: 'Válvulas',
    parentUuid: null,
    children: [],
    expanded: false,
  };

  /** Un campo de texto del formulario, con lo justo para leerlo y escribirlo desde el test. */
  type TextField = () => { value: { set(value: string): void } };

  /** La grilla de atributos: se indexa como array y se invoca para leer su valor. */
  type AttributesField = { name: TextField }[] & (() => { value: () => unknown[] });

  /** Acceso a los miembros `protected` que la plantilla usa. */
  const dialog = () =>
    fixture.componentInstance as unknown as {
      onAddAttribute(): void;
      onRemoveAttribute(index: number): void;
      onAttributeTypeChange(index: number, type: string): void;
      categoryForm: { name: TextField; attributes: AttributesField };
    };

  const render = (): void => {
    fixture = TestBed.createComponent(CategoryFormDialogComponent);
    fixture.detectChanges();
  };

  /** Resuelve el detalle que el diálogo pide al editar (el árbol no trae los atributos). */
  const flushDetail = (attributes: unknown[] | null): void => {
    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CATEGORIES.BY_UUID}/${CATEGORY.uuid}`))
      .flush({ uuid: CATEGORY.uuid, name: CATEGORY.name, categoryAttributes: attributes });
    fixture.detectChanges();
  };

  const addAttribute = (name: string, type = 'text'): void => {
    const page = dialog();
    page.onAddAttribute();
    fixture.detectChanges();

    const index = page.categoryForm.attributes().value().length - 1;
    page.categoryForm.attributes[index].name().value.set(name);
    page.onAttributeTypeChange(index, type);
    fixture.detectChanges();
  };

  const submit = (): void => {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  };

  const closedWith = (): CategoryFormDialogResult => close.mock.calls[0][0];

  beforeEach(async () => {
    close = vi.fn();
    data = { category: null, parent: null };

    await TestBed.configureTestingModule({
      imports: [CategoryFormDialogComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        // Factory y no `useValue`: cada test define su `data` después de configurar el TestBed.
        { provide: MAT_DIALOG_DATA, useFactory: () => data },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  it('creates a category with no attributes and asks for none', () => {
    render();

    dialog().categoryForm.name().value.set('Válvulas');
    fixture.detectChanges();
    submit();

    http.expectNone(apiUrl(`${API_ENDPOINTS.CATEGORIES.BY_UUID}/${CATEGORY.uuid}`));
    expect(closedWith()).toEqual({
      uuid: undefined,
      name: 'Válvulas',
      parentUuid: null,
      attributes: [],
    });
  });

  it('closes with the attributes added on the form, trimmed and without uuid', () => {
    render();

    dialog().categoryForm.name().value.set('Válvulas');
    addAttribute('  Color  ');
    addAttribute('Peso', 'decimal');
    submit();

    expect(closedWith().attributes).toEqual([
      { name: 'Color', type: 'text' },
      { name: 'Peso', type: 'decimal' },
    ]);
  });

  it('preloads the stored attributes when editing and keeps their uuid', () => {
    data = { category: CATEGORY, parent: null };
    render();
    flushDetail([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);

    submit();

    expect(closedWith().attributes).toEqual([{ uuid: 'attr-color', name: 'Color', type: 'text' }]);
  });

  it('drops a removed attribute so the backend deactivates it', () => {
    data = { category: CATEGORY, parent: null };
    render();
    flushDetail([
      { uuid: 'attr-color', name: 'Color', type: 'text' },
      { uuid: 'attr-peso', name: 'Peso', type: 'decimal' },
    ]);

    dialog().onRemoveAttribute(0);
    fixture.detectChanges();
    submit();

    expect(closedWith().attributes).toEqual([{ uuid: 'attr-peso', name: 'Peso', type: 'decimal' }]);
  });

  it('does not submit two attributes with the same name', () => {
    render();

    dialog().categoryForm.name().value.set('Válvulas');
    addAttribute('Color');
    addAttribute('color');
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('does not submit an attribute without a name', () => {
    render();

    dialog().categoryForm.name().value.set('Válvulas');
    addAttribute('');
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('sends no attribute list when the stored ones could not be read', () => {
    data = { category: CATEGORY, parent: null };
    render();

    http
      .expectOne(apiUrl(`${API_ENDPOINTS.CATEGORIES.BY_UUID}/${CATEGORY.uuid}`))
      .flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    submit();

    // `null` = «no tocar»: la página omite `categoryAttributes` y el backend los conserva.
    expect(closedWith().attributes).toBeNull();
  });
});
