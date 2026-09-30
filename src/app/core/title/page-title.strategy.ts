import { computed, DestroyRef, Injector, Service, inject } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/** The name in the tab, next to the screen's own. Matches the `<title>` in `index.html`. */
export const APP_TITLE = 'Ventosky';

const SEPARATOR = ' · ';

/**
 * What the browser tab says, off the `title` its route declares.
 *
 * A screen is configured **declaratively**, on its route — same as its breadcrumb:
 *
 * ```ts
 * { path: 'login', title: 'auth.login.title', loadComponent: ... }
 * ```
 *
 * and `title` is a **translation key**, not the text: the tab has to follow a
 * language change, which the router alone would not do because it only builds a
 * title while navigating. Resolving through {@link TranslateService.stream}
 * instead of `instant` is what keeps it in sync — the subscription outlives the
 * navigation and re-emits when the language changes, and the next navigation
 * drops it.
 *
 * The title of the deepest route in the chain wins, so an area declares its own
 * once and only an inner screen that reads differently ("Nuevo producto") has to
 * say anything. A screen that declares nothing leaves the tab on {@link APP_TITLE}
 * rather than on the previous screen's name.
 *
 * Cada tab puede estar operando en una sucursal distinta (ver `TabContextStore`), así que el título
 * la nombra: es lo único que distingue una solapa de otra sin abrirla. Va **primera** porque el
 * navegador recorta la solapa por el final, y con cuatro abiertas se perdería justo el dato que se
 * fue a buscar. Con una sola sucursal no aparece, misma regla que el switcher del sidebar: no
 * distingue nada y le come lugar al nombre de la pantalla.
 */
@Service()
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The translator is asked for on the first navigation, not injected as a
   * dependency — **on purpose**, and it has to stay that way.
   *
   * The router injects its `TitleStrategy` while it is being built, so a
   * `TranslateService` field would make the translator part of the router's own
   * construction. Building it loads a language, which is an HTTP request, and
   * `authErrorInterceptor` reaches for the `Router` to send an expired session
   * back to the login screen — a cycle that fails bootstrap with NG0200 before
   * the app renders at all. By the first navigation the router exists and the
   * same chain resolves.
   */
  private readonly injector = inject(Injector);

  /** The title on display. Dropped when another screen takes over. */
  private current: Subscription | null = null;

  /** Las dos partes variables del título, cada una de su fuente y con su propio ritmo. */
  private screenName: string | null = null;
  private branchName: string | null = null;

  private branchTracked = false;

  constructor() {
    super();

    this.destroyRef.onDestroy(() => this.current?.unsubscribe());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.trackBranch();

    this.current?.unsubscribe();
    this.current = null;

    const key = this.buildTitle(snapshot);

    if (!key) {
      this.screenName = null;
      this.render();
      return;
    }

    this.current = this.injector
      .get(TranslateService)
      .stream(key)
      .subscribe((name) => {
        this.screenName = name;
        this.render();
      });
  }

  /**
   * La sucursal se sigue una sola vez y para siempre: no cambia con la navegación, y llega **más
   * tarde** que la primera pantalla porque sale de un GET que dispara el guard del panel.
   *
   * `AuthService` se pide acá y no como dependencia por el mismo motivo que el traductor: es el
   * NG0200 del comentario de arriba. Para la primera navegación ya existe todo.
   */
  private trackBranch(): void {
    if (this.branchTracked) {
      return;
    }
    this.branchTracked = true;

    const auth = this.injector.get(AuthService);
    const label = computed(() => {
      const name = auth.selectedBranch()?.name?.trim();
      return (auth.availableBranches()?.length ?? 0) > 1 && name ? name : null;
    });

    toObservable(label, { injector: this.injector })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((name) => {
        this.branchName = name;
        this.render();
      });
  }

  private render(): void {
    this.title.setTitle(
      [this.branchName, this.screenName, APP_TITLE].filter(Boolean).join(SEPARATOR),
    );
  }
}
