import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { describe, beforeEach, expect, it } from 'vitest';
import { SkeletonComponent } from './skeleton.component';

describe('SkeletonComponent', () => {
  let fixture: ComponentFixture<SkeletonComponent>;

  const blocks = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.skeleton__block'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SkeletonComponent],
      providers: [provideTranslateService()],
    }).compileComponents();

    fixture = TestBed.createComponent(SkeletonComponent);
    fixture.detectChanges();
  });

  it('renders a single animated square block by default', () => {
    const [block] = blocks();

    expect(blocks()).toHaveLength(1);
    expect(block.classList).toContain('skeleton__block--animated');
    expect(block.classList).not.toContain('skeleton__block--circle');
    expect(block.style.borderRadius).toBe('0.25rem');
    expect(block.style.width).toBe('100%');
  });

  it('renders one block per count and shortens the last one', () => {
    fixture.componentRef.setInput('count', 3);
    fixture.componentRef.setInput('width', '20rem');
    fixture.componentRef.setInput('lastWidth', '60%');
    fixture.detectChanges();

    expect(blocks().map((block) => block.style.width)).toEqual(['20rem', '20rem', '60%']);
  });

  it('uses the height as diameter and a full radius on the circle shape', () => {
    fixture.componentRef.setInput('shape', 'circle');
    fixture.componentRef.setInput('height', '2.5rem');
    fixture.componentRef.setInput('width', '100%');
    fixture.detectChanges();

    const [block] = blocks();

    expect(block.classList).toContain('skeleton__block--circle');
    expect(block.style.width).toBe('2.5rem');
    expect(block.style.height).toBe('2.5rem');
    expect(block.style.borderRadius).toBe('50%');
  });

  it('never renders fewer than one block', () => {
    fixture.componentRef.setInput('count', 0);
    fixture.detectChanges();

    expect(blocks()).toHaveLength(1);
  });

  it('drops the animation class when animated is false', () => {
    fixture.componentRef.setInput('animated', false);
    fixture.detectChanges();

    expect(blocks()[0].classList).not.toContain('skeleton__block--animated');
  });

  it('exposes a busy status region with the given label', () => {
    fixture.componentRef.setInput('label', 'Cargando usuarios');
    fixture.detectChanges();

    const region = fixture.nativeElement.querySelector('.skeleton');

    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.getAttribute('aria-label')).toBe('Cargando usuarios');
  });
});
