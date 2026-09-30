import { Clipboard } from '@angular/cdk/clipboard';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, beforeEach, expect, it, vi } from 'vitest';
import { EmailDisplayComponent } from './email-display.component';

describe('EmailDisplayComponent', () => {
  let fixture: ComponentFixture<EmailDisplayComponent>;
  let copySpy: ReturnType<typeof vi.fn>;

  const copyButton = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector('button.email-display__action');

  const mailLink = (): HTMLAnchorElement | null =>
    fixture.nativeElement.querySelector('a.email-display__action');

  beforeEach(async () => {
    copySpy = vi.fn().mockReturnValue(true);

    await TestBed.configureTestingModule({
      imports: [EmailDisplayComponent],
      providers: [provideTranslateService(), { provide: Clipboard, useValue: { copy: copySpy } }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmailDisplayComponent);
    fixture.componentRef.setInput('email', ' user@example.com ');
    fixture.detectChanges();
  });

  it('renders the trimmed address', () => {
    const value = fixture.nativeElement.querySelector('.email-display__value');

    expect(value.textContent.trim()).toBe('user@example.com');
  });

  it('copies the address and emits it', () => {
    const copied = vi.fn();
    fixture.componentInstance.copied.subscribe(copied);

    copyButton()!.click();
    fixture.detectChanges();

    expect(copySpy).toHaveBeenCalledWith('user@example.com');
    expect(copied).toHaveBeenCalledWith('user@example.com');
    expect(copyButton()!.textContent.trim()).toBe('check');
  });

  it('emits copyFailed when the clipboard rejects the copy', () => {
    const copyFailed = vi.fn();
    copySpy.mockReturnValue(false);
    fixture.componentInstance.copyFailed.subscribe(copyFailed);

    copyButton()!.click();
    fixture.detectChanges();

    expect(copyFailed).toHaveBeenCalledWith('user@example.com');
    expect(copyButton()!.textContent.trim()).toBe('content_copy');
  });

  it('builds a mailto link with the optional subject and body', () => {
    fixture.componentRef.setInput('subject', 'Hola & bienvenida');
    fixture.componentRef.setInput('body', 'Texto');
    fixture.detectChanges();

    expect(mailLink()!.getAttribute('href')).toBe(
      'mailto:user%40example.com?subject=Hola%20%26%20bienvenida&body=Texto',
    );
  });

  it('hides the actions and shows a placeholder without an address', () => {
    fixture.componentRef.setInput('email', null);
    fixture.componentRef.setInput('emptyLabel', 'Sin correo');
    fixture.detectChanges();

    expect(copyButton()).toBeNull();
    expect(mailLink()).toBeNull();
    expect(fixture.nativeElement.querySelector('.email-display__empty').textContent.trim()).toBe(
      'Sin correo',
    );
  });
});
