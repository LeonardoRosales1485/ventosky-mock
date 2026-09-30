import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { CashSessionDto } from './cash-session.model';

/**
 * Apertura de la sesión de caja.
 *
 * Vive en `core/` por lo mismo que el resto de la carpeta: la sesión es condición de toda operación
 * —compra o venta— y la apertura se ofrece desde el mostrador y desde el ABM de cajas por igual.
 */
@Service()
export class CashSessionApiService {
  private readonly http = inject(HttpClient);

  /**
   * Abre la sesión de una caja con el efectivo con el que arranca.
   *
   * `openingAmount` es el punto de partida del arqueo: el backend lo guarda como esperado inicial en
   * efectivo y, si la última sesión cerrada dejó otro número, registra la diferencia como
   * discrepancia de apertura. Va siempre, incluso en cero.
   *
   * Responde `409` si la caja ya arrastra una sesión abierta. No hay reapertura ni «unirse» a una
   * sesión: la abierta la puede usar cualquier usuario autorizado, así que ante ese conflicto lo que
   * corresponde es releer la caja, no reintentar.
   */
  open(cashRegisterUuid: string, openingAmount: number): Observable<CashSessionDto> {
    return this.http.post<CashSessionDto>(
      apiUrl(API_ENDPOINTS.CASH_REGISTERS.OPEN_SESSION(cashRegisterUuid)),
      { openingAmount },
    );
  }
}
