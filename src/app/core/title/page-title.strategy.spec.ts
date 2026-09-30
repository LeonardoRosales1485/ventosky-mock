import { Component, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterOutlet, Routes, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { BranchDto } from '../branch/branch.model';
import { AuthService } from '../auth/auth.service';
import { APP_TITLE, PageTitleStrategy } from './page-title.strategy';

@Component({ selector: 'app-blank-page', template: '' })
class BlankPage {}

@Component({ selector: 'app-shell-page', imports: [RouterOutlet], template: '<router-outlet />' })
class ShellPage {}

/**
 * The shape the panel really has: a shell, and under it an area that carries the
 * title but no component of its own, the way a lazy `loadChildren` route does.
 */
const routes: Routes = [
  {
    path: 'panel',
    component: ShellPage,
    children: [
      { path: 'plain', component: BlankPage },
      {
        path: 'products',
        title: 'nav.items.products',
        children: [
          { path: '', component: BlankPage },
          { path: 'new', title: 'products.form.createTitle', component: BlankPage },
        ],
      },
    ],
  },
];

const CENTRO: BranchDto = { uuid: 'centro', name: 'Centro', active: true };
const NORTE: BranchDto = { uuid: 'norte', name: 'Norte', active: true };

describe('PageTitleStrategy', () => {
  let title: Title;
  let translate: TranslateService;
  let harness: RouterTestingHarness;
  let availableBranches: WritableSignal<BranchDto[] | null>;
  let selectedBranch: WritableSignal<BranchDto | null>;

  beforeEach(async () => {
    availableBranches = signal<BranchDto[] | null>(null);
    selectedBranch = signal<BranchDto | null>(null);

    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideTranslateService(),
        { provide: TitleStrategy, useExisting: PageTitleStrategy },
        // La sucursal es lo único que se le pide, y llega tarde: se controla desde el test.
        { provide: AuthService, useValue: { availableBranches, selectedBranch } },
      ],
    });

    translate = TestBed.inject(TranslateService);
    translate.setTranslation('es', {
      nav: { items: { products: 'Productos' } },
      products: { form: { createTitle: 'Nuevo producto' } },
    });
    translate.setTranslation('en', {
      nav: { items: { products: 'Products' } },
      products: { form: { createTitle: 'New product' } },
    });
    translate.use('es');

    title = TestBed.inject(Title);
    harness = await RouterTestingHarness.create();
  });

  it('names the tab after the screen, translated, next to the app', async () => {
    await harness.navigateByUrl('/panel/products');

    expect(title.getTitle()).toBe(`Productos · ${APP_TITLE}`);
  });

  it('lets an inner screen override the title of the area it lives in', async () => {
    await harness.navigateByUrl('/panel/products/new');

    expect(title.getTitle()).toBe(`Nuevo producto · ${APP_TITLE}`);
  });

  it('follows a language change without navigating again', async () => {
    await harness.navigateByUrl('/panel/products');

    translate.use('en');

    expect(title.getTitle()).toBe(`Products · ${APP_TITLE}`);
  });

  /**
   * Con varios tabs abiertos en sucursales distintas, el nombre de la solapa es lo único que las
   * distingue. Va primero porque el navegador la recorta por el final.
   */
  it('names the branch this tab operates in, ahead of the screen', async () => {
    availableBranches.set([CENTRO, NORTE]);
    selectedBranch.set(CENTRO);

    await harness.navigateByUrl('/panel/products');
    await harness.fixture.whenStable();

    expect(title.getTitle()).toBe(`Centro · Productos · ${APP_TITLE}`);
  });

  /** El listado sale de un GET que dispara el guard, así que llega después de la primera pantalla. */
  it('picks up a branch that resolves after the screen', async () => {
    await harness.navigateByUrl('/panel/products');
    await harness.fixture.whenStable();

    expect(title.getTitle()).toBe(`Productos · ${APP_TITLE}`);

    availableBranches.set([CENTRO, NORTE]);
    selectedBranch.set(NORTE);
    await harness.fixture.whenStable();

    expect(title.getTitle()).toBe(`Norte · Productos · ${APP_TITLE}`);
  });

  /** Con una sola sucursal no distingue nada, y le come lugar al nombre de la pantalla. */
  it('leaves the branch out when there is only one', async () => {
    availableBranches.set([CENTRO]);
    selectedBranch.set(CENTRO);

    await harness.navigateByUrl('/panel/products');
    await harness.fixture.whenStable();

    expect(title.getTitle()).toBe(`Productos · ${APP_TITLE}`);
  });

  it('drops the previous screen title when the next one declares none', async () => {
    await harness.navigateByUrl('/panel/products');
    await harness.navigateByUrl('/panel/plain');

    expect(title.getTitle()).toBe(APP_TITLE);

    // The screen it left is gone for good: its key must not write the tab again.
    translate.use('en');

    expect(title.getTitle()).toBe(APP_TITLE);
  });
});
