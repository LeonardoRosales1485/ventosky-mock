import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { applyEach, form, validate } from '@angular/forms/signals';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AttributeValueModel } from '../../data-access/directory-forms';
import { attributeValueError } from '../directory-form-dialog/directory-form.schema';
import { DirectoryAttributeFieldsComponent } from './directory-attribute-fields.component';

const attribute = (
  name: string,
  value = '',
  type: AttributeValueModel['type'] = 'text',
): AttributeValueModel => ({ attributeUuid: `uuid-${name}`, name, type, value });

@Component({
  imports: [DirectoryAttributeFieldsComponent],
  template: `<app-directory-attribute-fields [attributes]="testForm.attributes" />`,
})
class HostComponent {
  readonly model = signal<{ attributes: AttributeValueModel[] }>({ attributes: [] });
  readonly testForm = form(this.model, (path) => {
    applyEach(path.attributes, (item) => {
      validate(item.value, ({ value, valueOf }) => attributeValueError(valueOf(item.type), value()));
    });
  });
}

describe('DirectoryAttributeFieldsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const toggle = (): HTMLButtonElement => element().querySelector('button') as HTMLButtonElement;
  const fields = (): number => element().querySelectorAll('mat-form-field').length;

  const render = (attributes: AttributeValueModel[]): void => {
    host.model.set({ attributes });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideTranslateService()],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('es', {
      directory: { form: { attributesCount: '{{filled}} de {{total}} completos' } },
    });
    translate.use('es');

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('shows a short list open', () => {
    render([attribute('Talle'), attribute('Obra social'), attribute('Turno')]);

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(fields()).toBe(3);
  });

  /** Con muchos campos el bloque tapa el resto de la ficha: arranca plegado y dice cuántos están completos. */
  it('folds a long list and says how many are filled in', () => {
    render([
      attribute('Talle', 'M'),
      attribute('Obra social', 'OSDE'),
      attribute('Turno'),
      attribute('Legajo previo'),
    ]);

    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(fields()).toBe(0);
    expect(toggle().textContent).toContain('2 de 4 completos');
  });

  it('opens and folds on demand', () => {
    render([attribute('A'), attribute('B'), attribute('C'), attribute('D')]);

    toggle().click();
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(fields()).toBe(4);

    toggle().click();
    fixture.detectChanges();
    expect(fields()).toBe(0);
  });

  /** Un campo plegado no puede frenar el guardado sin decir por qué. */
  it('opens a folded list when a field shows an error', () => {
    render([
      attribute('A'),
      attribute('B'),
      attribute('C'),
      attribute('Hijos a cargo', 'dos', 'number'),
    ]);
    expect(fields()).toBe(0);

    host.testForm().markAsTouched();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(element().querySelectorAll('mat-error').length).toBe(1);
  });
});
