import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { BreadcrumbItem } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbBarComponent } from './breadcrumb-bar.component';

/** Renders the bar over a trail the test publishes, and returns its DOM. */
function render(items: readonly BreadcrumbItem[]): HTMLElement {
  const breadcrumb = TestBed.inject(BreadcrumbService);
  TestBed.runInInjectionContext(() => breadcrumb.publish(() => items));

  const fixture = TestBed.createComponent(BreadcrumbBarComponent);
  fixture.detectChanges();

  return fixture.nativeElement as HTMLElement;
}

describe('BreadcrumbBarComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideTranslateService()],
    });

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('es', { nav: { items: { applications: 'Aplicaciones' } } });
    translate.use('es');
  });

  it('translates a crumb declared by key, and leaves a resolved label alone', () => {
    const element = render([
      { labelKey: 'nav.items.applications', link: '/panel/applications' },
      { label: 'nav.items.applications' },
    ]);

    // The literal label is a record's own name: it must reach the DOM as it is,
    // even when it happens to look like a translation key.
    expect(element.querySelector('a')?.textContent?.trim()).toBe('Aplicaciones');
    expect(element.querySelector('.breadcrumb-bar__current')?.textContent?.trim()).toBe(
      'nav.items.applications',
    );
  });

  it('renders the last crumb as the current page rather than a link', () => {
    const element = render([
      { labelKey: 'nav.items.applications', link: '/panel/applications' },
      { label: 'Acme', link: '/panel/applications/1' },
    ]);

    expect(element.querySelectorAll('a')).toHaveLength(1);
    expect(element.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Acme');
  });
});
