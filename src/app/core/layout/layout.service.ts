import { BreakpointObserver } from '@angular/cdk/layout';
import {
  DestroyRef,
  Service,
  computed,
  effect,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { map } from 'rxjs';

/** Matches Tailwind `md` breakpoint (768px). */
const MOBILE_MEDIA_QUERY = '(max-width: 767.98px)';

@Service()
export class LayoutService {
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly isMobile = toSignal(
    this.breakpointObserver
      .observe(MOBILE_MEDIA_QUERY)
      .pipe(map((state) => state.matches)),
    { initialValue: this.readInitialIsMobile() },
  );

  /**
   * Desktop: collapsed = icon rail. Mobile: collapsed = drawer closed.
   */
  readonly sidebarCollapsed = signal(this.readInitialIsMobile());

  /**
   * La pantalla que pidió el modo inmersivo, mientras siga viva. Se guarda la referencia y no un
   * booleano para poder soltarlo sin pisar a la pantalla siguiente: en algunas navegaciones la
   * anterior se destruye **después** de que la nueva se creó.
   */
  private readonly immersiveOwner = signal<object | null>(null);

  private readonly _immersive = signal(false);

  /**
   * El shell se corre entero: sin topbar, sin breadcrumb, sin rail y sin padding.
   *
   * Es para las pantallas que *son* la aplicación mientras se usan —el punto de venta en un
   * mostrador— donde el cromo del panel no es contexto útil sino alto de pantalla que se le quita
   * al trabajo. La pantalla lo pide con {@link requestImmersive} y lo puede soltar sin navegar,
   * que es como se vuelve a tener el menú a mano.
   */
  readonly immersive = this._immersive.asReadonly();

  /** Hay una pantalla que admite el modo: es lo que habilita el botón que lo prende y apaga. */
  readonly immersiveAvailable = computed(() => this.immersiveOwner() !== null);

  readonly sidebarOpened = computed(() => {
    if (this._immersive()) {
      return false;
    }

    return this.isMobile() ? !this.sidebarCollapsed() : true;
  });

  readonly sidenavMode = computed(() => (this.isMobile() ? 'over' : 'side'));

  constructor() {
    effect(() => {
      const mobile = this.isMobile();
      untracked(() => this.sidebarCollapsed.set(mobile));
    });
  }

  /**
   * Entra en modo inmersivo mientras la pantalla que llama siga viva.
   *
   * **Llamar desde un contexto de inyección** —el constructor o la inicialización de un campo—:
   * el modo se ata al componente y no a una navegación, así que se suelta solo al salir de la
   * pantalla y no puede quedarse prendido sobre la siguiente.
   */
  requestImmersive(): void {
    const destroyRef = inject(DestroyRef);
    const owner = {};

    this.immersiveOwner.set(owner);
    this._immersive.set(true);

    destroyRef.onDestroy(() => {
      if (this.immersiveOwner() === owner) {
        this.immersiveOwner.set(null);
        this._immersive.set(false);
      }
    });
  }

  /** Prende y apaga el modo sin navegar; sólo hace algo si hay una pantalla que lo admite. */
  setImmersive(immersive: boolean): void {
    if (this.immersiveAvailable()) {
      this._immersive.set(immersive);
    }
  }

  toggleImmersive(): void {
    this.setImmersive(!this._immersive());
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed.set(collapsed);
  }

  setSidebarOpened(opened: boolean): void {
    if (this.isMobile()) {
      this.sidebarCollapsed.set(!opened);
    }
  }

  closeMobileSidebar(): void {
    if (this.isMobile()) {
      this.sidebarCollapsed.set(true);
    }
  }

  private readInitialIsMobile(): boolean {
    if (!this.isBrowser) {
      return false;
    }

    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  }
}
