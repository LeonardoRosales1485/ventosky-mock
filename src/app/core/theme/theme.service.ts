import { Service, signal, effect, inject, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'bod-fe-scaffold.theme';

@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly theme = signal<ThemeMode>(this.readInitialTheme());

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.document.body.style.colorScheme = theme;
      if (this.isBrowser) {
        localStorage.setItem(STORAGE_KEY, theme);
      }
    });
  }

  setTheme(theme: ThemeMode): void {
    this.theme.set(theme);
  }

  toggleTheme(): void {
    this.theme.update((current) => (current === 'light' ? 'dark' : 'light'));
  }

  private readInitialTheme(): ThemeMode {
    if (!this.isBrowser) {
      return 'light';
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}
