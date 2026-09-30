import { Service, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  EXPIRED_BATCH_POLICIES,
  ExpiredBatchPolicy,
  STOCK_VALIDATION_POLICIES,
  StockValidationPolicy,
} from '../orders/order-commit.model';
import { ConfigurationApiService } from './configuration-api.service';
import {
  CONFIGURATION_KEYS,
  ConfigurationScope,
  EffectiveSettingDto,
  isConfigurationScope,
} from './configuration.model';

/**
 * Los valores de configuración que rigen para el contexto de este tab, leídos una sola vez.
 *
 * Reemplaza a `getSaleSettings()` y sus hermanos, que pedían **una clave por request** y, cuando la
 * lectura fallaba —un cajero sin permiso para leerla, por ejemplo— caían a un default escrito en el
 * front. Ese default podía discrepar del que aplicaba el backend, y ahí la pantalla anticipaba una
 * cosa y el servidor hacía otra.
 *
 * Acá **no hay defaults del front**: `/configuration/effective` responde todas las claves con su
 * valor efectivo, y el valor por defecto ya viene resuelto adentro de esa respuesta. Si la carga no
 * ocurrió o falló, los accesos devuelven `null`, que significa «no sé» y no «vale X». Quien lee
 * decide qué hacer sin saber, y lo razonable casi siempre es no anticipar nada y dejar que conteste
 * el backend.
 *
 * Se carga una vez por `(empresa, sucursal)`: cambiar de sucursal recarga la aplicación entera, así
 * que una vez alcanza. El contexto se compara igual, para el caso en que no la recargue.
 */
@Service()
export class ConfigurationStore {
  private readonly api = inject(ConfigurationApiService);
  private readonly auth = inject(AuthService);

  private readonly _settings = signal<ReadonlyMap<string, EffectiveSettingDto>>(new Map());
  private readonly _loaded = signal(false);

  /** El contexto del que salió lo que hay cargado, o `null` si no hay nada. */
  private loadedContext: string | null = null;

  /** La carga en curso, compartida: dos pantallas que arrancan juntas hacen un solo request. */
  private inFlight: Observable<void> | null = null;

  /** `true` cuando ya hay una respuesta —aunque haya sido un error— y no se está esperando otra. */
  readonly loaded = this._loaded.asReadonly();

  /**
   * Carga los valores del contexto activo si todavía no están. Es lo que llama el panel al entrar:
   * la configuración se usa en el punto de venta, en compras y en el layout, y pedirla en cada una
   * sería el mismo request tres veces.
   */
  load(): Observable<void> {
    const context = this.currentContext();
    if (this.loadedContext === context && this._loaded()) {
      return of(undefined);
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.api.effective().pipe(
      map((settings) => this.absorb(settings, context)),
      // Una configuración que no se pudo leer no puede frenar el panel: se deja vacía y quien
      // lee recibe `null`. La alternativa —romper la navegación— es peor que no anticipar.
      catchError(() => {
        this.absorb([], context);
        return of(undefined);
      }),
      tap(() => (this.inFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.inFlight;
  }

  /**
   * Vuelve a pedir los valores del contexto activo. Lo usa la pantalla de configuración después de
   * guardar, para que el resto de la aplicación no siga con el snapshot viejo.
   */
  reload(): Observable<void> {
    this.loadedContext = null;
    this._loaded.set(false);
    this.inFlight = null;
    return this.load();
  }

  /** El valor crudo que rige para la clave, o `null` si no se cargó nada. */
  raw(key: string): string | null {
    return this._settings().get(key)?.value ?? null;
  }

  /** El nivel del que salió el valor, o `null` si no se cargó nada. */
  sourceOf(key: string): ConfigurationScope | null {
    const source = this._settings().get(key)?.source;
    return source && isConfigurationScope(source) ? source : null;
  }

  /**
   * Qué hace la venta cuando falta stock, o `null` si no se pudo leer.
   *
   * `null` no es un caso raro y no tiene default: significa que la pantalla no puede anticipar el
   * bloqueo, así que manda el commit y muestra lo que conteste el backend. Es la misma decisión que
   * toma con un faltante que aparece entre que se leyó el stock y se cobró.
   */
  readonly stockValidationPolicy = computed<StockValidationPolicy | null>(() =>
    oneOf(STOCK_VALIDATION_POLICIES, this.raw(CONFIGURATION_KEYS.stockValidationPolicy)),
  );

  /** Qué hace el despacho con un lote vencido, o `null` si no se pudo leer. */
  readonly stockExpiredPolicy = computed<ExpiredBatchPolicy | null>(() =>
    oneOf(EXPIRED_BATCH_POLICIES, this.raw(CONFIGURATION_KEYS.stockExpiredPolicy)),
  );

  /** El formato de la etiqueta de balanza, o `null` si la empresa no vende pesables. */
  readonly scaleBarcodeFormat = computed(() => this.raw(CONFIGURATION_KEYS.scaleBarcodeFormat));

  /** El color del menú del layout principal, o `null` si no se pudo leer. */
  readonly menuColor = computed(() => this.raw(CONFIGURATION_KEYS.menuColor));

  private absorb(settings: readonly EffectiveSettingDto[], context: string): void {
    this._settings.set(new Map(settings.map((setting) => [setting.key, setting])));
    this.loadedContext = context;
    this._loaded.set(true);
  }

  private currentContext(): string {
    return `${this.auth.selectedCompanyUuid() ?? ''}|${this.auth.selectedBranchUuid() ?? ''}`;
  }
}

/** El valor si es uno de los admitidos, o `null`. Nunca cae a un default del front (RN-12). */
function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}
