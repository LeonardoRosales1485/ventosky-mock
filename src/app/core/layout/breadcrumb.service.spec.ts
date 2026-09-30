import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BreadcrumbService } from './breadcrumb.service';

@Component({ selector: 'app-blank-page', template: '' })
class BlankPage {}

@Component({ selector: 'app-shell-page', imports: [RouterOutlet], template: '<router-outlet />' })
class ShellPage {}

/** Stands in for a detail screen: its last crumb is the record's own name. */
@Component({ selector: 'app-detail-page', template: '' })
class DetailPage {
  private readonly breadcrumb = inject(BreadcrumbService);

  constructor() {
    this.breadcrumb.publish(() => [{ label: 'Acme' }]);
  }
}

const routes: Routes = [
  { path: 'plain', component: BlankPage },
  {
    path: 'applications',
    component: ShellPage,
    data: { breadcrumb: [{ labelKey: 'nav.items.home', link: '/panel/home' }] },
    children: [
      {
        path: '',
        pathMatch: 'full',
        data: { breadcrumb: { labelKey: 'nav.items.applications' } },
        component: BlankPage,
      },
      {
        path: ':id',
        data: { breadcrumb: { labelKey: 'nav.items.applications', link: '/applications' } },
        component: DetailPage,
      },
    ],
  },
];

describe('BreadcrumbService', () => {
  let breadcrumb: BreadcrumbService;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });

    breadcrumb = TestBed.inject(BreadcrumbService);
    harness = await RouterTestingHarness.create();
  });

  it('shows no breadcrumb on a screen that declares none', async () => {
    await harness.navigateByUrl('/plain');

    expect(breadcrumb.items()).toEqual([]);
    expect(breadcrumb.visible()).toBe(false);
  });

  it('builds the trail from every route in the chain, in order', async () => {
    await harness.navigateByUrl('/applications');

    expect(breadcrumb.items().map((item) => item.labelKey)).toEqual([
      'nav.items.home',
      'nav.items.applications',
    ]);
    expect(breadcrumb.visible()).toBe(true);
  });

  it('does not repeat a parent crumb the router handed down to its child', async () => {
    // The child inherits the parent's resolved `data`, so a trail read off it
    // would carry `nav.items.home` twice.
    await harness.navigateByUrl('/applications');

    const homeCrumbs = breadcrumb.items().filter((item) => item.labelKey === 'nav.items.home');

    expect(homeCrumbs).toHaveLength(1);
  });

  it("lets the screen publish over what its route declares, and drops it when it's gone", async () => {
    await harness.navigateByUrl('/applications/app-1');

    expect(breadcrumb.items()).toEqual([{ label: 'Acme' }]);

    await harness.navigateByUrl('/applications');

    expect(breadcrumb.items().map((item) => item.labelKey)).toEqual([
      'nav.items.home',
      'nav.items.applications',
    ]);
  });

  it('drops a published trail when the screen is left for one with no breadcrumb', async () => {
    await harness.navigateByUrl('/applications/app-1');
    await harness.navigateByUrl('/plain');

    expect(breadcrumb.visible()).toBe(false);
  });
});
