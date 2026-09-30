import { afterEach } from 'vitest';

/**
 * Global setup for unit tests. jsdom implements no CSS media queries, so
 * anything reading `matchMedia` (the theme service, Material breakpoints)
 * throws. Stub it as "no query matches" unless the environment provides it.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<EventListenerOrEventListenerObject>();

    return {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener);
      },
      addListener: (listener: EventListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: EventListener) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
}

/**
 * Ningún test hereda el contexto del anterior: `sessionStorage` sobrevive entre casos, así que el
 * tab sellado por un test le quedaría sellado al siguiente. Se limpian los dos storages porque el
 * contexto vive en uno y su semilla en el otro (ver `TabContextStore`).
 */
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
