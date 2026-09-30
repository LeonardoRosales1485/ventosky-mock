import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { allBranchesScope } from '../http/branch-scope';
import {
  EffectiveSettingDto,
  SettingDefinitionDto,
  SettingSavePayload,
} from './configuration.model';

/** Qué contexto se quiere leer, y con cuánto detalle. */
export interface EffectiveQuery {
  /**
   * Adjunta el valor crudo de cada nivel además del efectivo. Lo necesita la pantalla de
   * configuración —para decir a qué valor vuelve un «Restablecer»— y nadie más.
   */
  levels?: boolean;
  /**
   * Lee el contexto de la empresa, sin sucursal. Es lo que hace el selector de nivel «Empresa»: sin
   * `X-Branch-Uuid` el backend no considera el peldaño de la sucursal, así que el `source` que
   * responde nunca dice `BRANCH`.
   */
  companyOnly?: boolean;
  /**
   * Inspecciona **otra** sucursal del inquilino en lugar de la del header. Exige
   * `configuration.view`, así que sólo se manda cuando la sucursal elegida no es la activa: un
   * encargado que configura su propia sucursal no debería necesitar el permiso de inspección.
   */
  branchUuid?: string;
}

/**
 * Las tres llamadas de configuración. Es un servicio de `core/` y no de una feature porque lo
 * consumen el punto de venta, el layout y la pantalla de configuración, y un `*ApiService` de
 * feature no se puede cruzar sin `NG0201`.
 */
@Service()
export class ConfigurationApiService {
  private readonly http = inject(HttpClient);

  /** El catálogo de claves. Sin `configuration.view` el backend omite las privadas. */
  definitions(): Observable<SettingDefinitionDto[]> {
    return this.http.get<SettingDefinitionDto[]>(apiUrl(API_ENDPOINTS.CONFIGURATION.DEFINITIONS));
  }

  effective(query: EffectiveQuery = {}): Observable<EffectiveSettingDto[]> {
    let params = new HttpParams();
    if (query.levels) {
      params = params.set('levels', 'true');
    }
    if (query.branchUuid) {
      params = params.set('branchUuid', query.branchUuid);
    }

    return this.http.get<EffectiveSettingDto[]>(apiUrl(API_ENDPOINTS.CONFIGURATION.EFFECTIVE), {
      params,
      ...(query.companyOnly ? { context: allBranchesScope() } : {}),
    });
  }

  /**
   * La solapa entera en un request. El lote es **atómico**: si una clave no valida no se guarda
   * ninguna, que es lo que hace que un guardado a medias no sea un estado posible.
   */
  saveList(payloads: readonly SettingSavePayload[]): Observable<unknown[]> {
    return this.http.post<unknown[]>(apiUrl(API_ENDPOINTS.CONFIGURATION.SAVE_LIST), payloads);
  }
}
