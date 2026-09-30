import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, Service, inject, signal } from '@angular/core';

/**
 * La pantalla completa **del navegador** —la de `F11`—, que es otra cosa que el modo inmersivo del
 * shell: éste esconde el cromo de la aplicación, ésta esconde el del navegador (pestañas, barra de
 * direcciones, marcadores). Un punto de venta las quiere a las dos: lo que queda en pantalla es el
 * carrito y nada más.
 *
 * La API sólo se concede sobre un gesto del usuario, así que {@link request} tiene que salir de un
 * clic o una tecla; fuera de eso el navegador la rechaza. Por eso no se pide sola al entrar a
 * ninguna pantalla: la pide el botón que el operador aprieta cuando la quiere. El rechazo se traga:
 * no poder ocupar la pantalla entera no es motivo para no dejar vender, y el modo inmersivo del
 * shell funciona igual.
 */
@Service()
export class FullscreenService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly _active = signal(false);

  /**
   * Si el documento está en pantalla completa ahora mismo.
   *
   * Se sincroniza con el evento del navegador y no con lo que pidió la aplicación: `Esc` y `F11`
   * salen sin avisarle a nadie, y una pantalla que se creyera dueña del estado quedaría mintiendo.
   */
  readonly active = this._active.asReadonly();

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    this.document.addEventListener('fullscreenchange', () =>
      this._active.set(this.document.fullscreenElement !== null),
    );
  }

  /** Pide la pantalla completa. Debe llamarse desde un gesto del usuario. */
  request(): void {
    if (!this.isBrowser || this.document.fullscreenElement) {
      return;
    }

    void this.document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  exit(): void {
    if (!this.isBrowser || !this.document.fullscreenElement) {
      return;
    }

    void this.document.exitFullscreen?.().catch(() => undefined);
  }

  /**
   * Entra o sale, según dónde esté. Es lo que necesita un botón: el mismo gesto que la pide es el
   * que la devuelve, y el estado lo lee del navegador —no de lo que la aplicación cree haber
   * pedido—, así que un `F11` o un `Esc` por fuera no lo dejan desincronizado.
   */
  toggle(): void {
    if (this.document.fullscreenElement) {
      this.exit();
      return;
    }

    this.request();
  }
}
