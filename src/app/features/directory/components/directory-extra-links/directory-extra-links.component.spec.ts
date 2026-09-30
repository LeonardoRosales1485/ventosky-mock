import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DirectoryFormModel,
  ExtraLinksPlan,
  NO_EXTRA_LINKS,
  toFormModel,
} from '../../data-access/directory-forms';
import { DirectoryLinkDetection } from '../../data-access/directory-link-detection';
import { DirectoryExtraLinksComponent } from './directory-extra-links.component';

@Component({
  imports: [DirectoryExtraLinksComponent],
  template: `
    <app-directory-extra-links [form]="linksForm" [plan]="plan()" [detection]="detection()" />
  `,
})
class HostComponent {
  readonly model = signal<DirectoryFormModel>(toFormModel('CUSTOMER', null));
  readonly linksForm = form(this.model);
  readonly plan = signal<ExtraLinksPlan>(NO_EXTRA_LINKS);
  readonly detection = signal<DirectoryLinkDetection>({ status: 'idle', detected: [] });
}

/** Sin traducciones cargadas, el pipe devuelve la clave: el texto dice qué mensaje eligió el componente. */
describe('DirectoryExtraLinksComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => element().textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('draws nothing while the roles require no other link', () => {
    fixture.detectChanges();

    expect(element().querySelectorAll('section')).toHaveLength(0);
  });

  /** «Rol martita»: comprador y transportista a la vez. El legajo se pide una vez, en el primero de empleado. */
  it('asks the fields of each link with the permissions that require it', () => {
    host.plan.set({ links: ['TRANSPORTIST', 'BUYER'], employmentLink: 'TRANSPORTIST' });
    host.detection.set({
      status: 'ready',
      detected: [
        {
          link: 'TRANSPORTIST',
          because: ['transfer.dispatch', 'transfer.receive'],
          alreadyHas: false,
        },
        { link: 'BUYER', because: ['purchase.create', 'supplier.view'], alreadyHas: false },
      ],
    });
    fixture.detectChanges();

    const sections = element().querySelectorAll('section');
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain('directory.extraLinks.lead');
    expect(sections[0].textContent).toContain('transfer.dispatch');
    expect(sections[0].textContent).toContain('directory.form.fileNumber');
    expect(sections[0].textContent).toContain('directory.form.licenseNumber');
    expect(sections[1].textContent).toContain('purchase.create');
    expect(sections[1].textContent).toContain('directory.form.buyerHasNoFields');
    expect(sections[1].textContent).not.toContain('directory.form.fileNumber');
  });

  it('says it is checking, and when it could not check', () => {
    host.detection.set({ status: 'loading', detected: [] });
    fixture.detectChanges();
    expect(text()).toContain('directory.extraLinks.detecting');

    host.detection.set({ status: 'error', detected: [] });
    fixture.detectChanges();
    expect(text()).toContain('directory.extraLinks.detectError');
  });
});
