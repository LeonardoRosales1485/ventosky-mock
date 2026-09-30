import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DirectoryLink } from '../../../../core/parties/directory-links';
import { AccessModel, EMPTY_ACCESS } from '../../data-access/directory-forms';
import { DirectoryAccessBlockComponent } from './directory-access-block.component';

@Component({
  imports: [DirectoryAccessBlockComponent],
  template: `
    <app-directory-access-block
      [access]="accessForm"
      [variant]="link() ? 'optional' : 'grant'"
      [link]="link()"
    />
  `,
})
class HostComponent {
  readonly link = input<DirectoryLink | null>(null);
  readonly model = signal<AccessModel>({ ...EMPTY_ACCESS, enabled: true });
  readonly accessForm = form(this.model);
}

/** Sin traducciones cargadas, el pipe devuelve la clave: el texto dice qué mensaje eligió el bloque. */
describe('DirectoryAccessBlockComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('warns that a new user without roles cannot do anything', () => {
    fixture.detectChanges();

    expect(text()).toContain('directory.access.noRoles');
    expect(text()).not.toContain('directory.access.noRolesToAdd');
  });

  /** Quien ya entra conserva sus roles: sin roles para sumar no se queda sin poder hacer nada. */
  it('says nothing is added when the person already signs in', () => {
    host.model.set({
      ...EMPTY_ACCESS,
      enabled: true,
      existingUserUuid: 'user-uuid',
      existingUsername: 'cajero.1',
    });
    fixture.detectChanges();

    expect(text()).toContain('directory.access.noRolesToAdd');
  });
});
