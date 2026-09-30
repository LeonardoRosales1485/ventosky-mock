import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterOutlet, Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LayoutService } from './layout.service';

@Component({ selector: 'app-blank-page', template: '' })
class BlankPage {}

@Component({ selector: 'app-shell-page', imports: [RouterOutlet], template: '<router-outlet />' })
class ShellPage {}

/** Stands in for the point of sale: takes over the viewport for as long as it is on screen. */
@Component({ selector: 'app-immersive-page', template: '' })
class ImmersivePage {
  constructor() {
    inject(LayoutService).requestImmersive();
  }
}

const routes: Routes = [
  {
    path: 'panel',
    component: ShellPage,
    children: [
      { path: 'plain', component: BlankPage },
      { path: 'immersive', component: ImmersivePage },
    ],
  },
];

describe('LayoutService immersive mode', () => {
  let layout: LayoutService;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });

    layout = TestBed.inject(LayoutService);
    harness = await RouterTestingHarness.create();
  });

  it('stays off on a screen that does not ask for it', async () => {
    await harness.navigateByUrl('/panel/plain');

    expect(layout.immersive()).toBe(false);
    expect(layout.immersiveAvailable()).toBe(false);
  });

  it('turns on while the screen that asked for it is on display', async () => {
    await harness.navigateByUrl('/panel/immersive');

    expect(layout.immersive()).toBe(true);
    expect(layout.immersiveAvailable()).toBe(true);
  });

  /** El modo se ata al componente: navegar afuera no puede dejar al panel sin topbar ni menú. */
  it('releases it when navigating away', async () => {
    await harness.navigateByUrl('/panel/immersive');
    await harness.navigateByUrl('/panel/plain');

    expect(layout.immersive()).toBe(false);
    expect(layout.immersiveAvailable()).toBe(false);
  });

  it('hides the sidebar while it is on, and gives it back when it is off', async () => {
    await harness.navigateByUrl('/panel/immersive');
    expect(layout.sidebarOpened()).toBe(false);

    layout.setImmersive(false);
    expect(layout.sidebarOpened()).toBe(true);
  });

  /** Apagarlo sin navegar es cómo se llega al menú: la pantalla sigue viva y lo puede volver a pedir. */
  it('toggles without navigating, and the screen keeps offering it', async () => {
    await harness.navigateByUrl('/panel/immersive');

    layout.toggleImmersive();
    expect(layout.immersive()).toBe(false);
    expect(layout.immersiveAvailable()).toBe(true);

    layout.toggleImmersive();
    expect(layout.immersive()).toBe(true);
  });

  /** Sin una pantalla que lo admita, prenderlo dejaría el panel sin cromo y sin quién lo devuelva. */
  it('cannot be turned on by anyone else', () => {
    layout.setImmersive(true);

    expect(layout.immersive()).toBe(false);
  });
});
