import { Service, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';

export type AppLanguage = 'es' | 'en';

export interface LanguageOption {
  code: AppLanguage;
  labelKey: string;
  flag: string;
}

const STORAGE_KEY = 'bod-fe-scaffold.lang';

const LOCALE_BY_LANG: Record<AppLanguage, string> = {
  es: 'es-AR',
  en: 'en-US',
};

@Service()
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly languages: LanguageOption[] = [
    { code: 'es', labelKey: 'settings.languages.es', flag: '🇦🇷' },
    { code: 'en', labelKey: 'settings.languages.en', flag: '🇺🇸' },
  ];

  readonly currentLang = signal<AppLanguage>(this.readInitialLanguage());
  readonly localeId = computed(() => LOCALE_BY_LANG[this.currentLang()]);

  constructor() {
    const lang = this.currentLang();
    this.translate.use(lang);
    this.document.documentElement.lang = lang;
  }

  setLanguage(lang: AppLanguage): void {
    this.currentLang.set(lang);
    this.translate.use(lang);
    this.document.documentElement.lang = lang;

    if (this.isBrowser) {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  }

  private readInitialLanguage(): AppLanguage {
    if (!this.isBrowser) {
      return 'es';
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'es' || stored === 'en') {
      return stored;
    }

    return 'es';
  }
}
