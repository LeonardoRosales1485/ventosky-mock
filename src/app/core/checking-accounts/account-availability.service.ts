import { HttpClient, HttpParams } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { AccountAvailabilityDto, AccountOperation } from './account-availability.model';

/**
 * El disponible de cuenta corriente de un titular, en un solo viaje.
 *
 * Vive en `core/` porque lo consumen el punto de venta y la nueva compra, dos features que no se
 * importan entre sí; y es propio en vez de reusar el `CheckingAccountsApiService` del módulo por lo
 * mismo — ese servicio es del feature, y el mostrador no tiene por qué depender de él para una
 * pregunta que se contesta con un `GET`.
 */
@Service()
export class AccountAvailabilityService {
  private readonly http = inject(HttpClient);

  /**
   * `GET /checking-account/party-role/{uuid}/availability`.
   *
   * @param amount el importe que se quiere llevar a cuenta. Omitido, la respuesta contesta si se
   *   puede llevar **algo**, que es lo que el panel necesita antes de que el operador tipee nada.
   *
   * **404 cuando el titular no tiene cuenta**, y eso no se traduce a un disponible en cero: no es lo
   * mismo «no puede llevar nada» que «no hay a quién preguntarle». Quien llama decide qué hacer con
   * el error; lo que no debe hacer es inventar una respuesta.
   */
  forPartyRole(
    partyRoleUuid: string,
    operation: AccountOperation,
    amount?: number,
  ): Observable<AccountAvailabilityDto> {
    let params = new HttpParams().set('operation', operation);
    if (amount != null) {
      params = params.set('amount', amount);
    }

    return this.http.get<AccountAvailabilityDto>(
      apiUrl(
        `${API_ENDPOINTS.CHECKING_ACCOUNTS.BY_PARTY_ROLE}/${partyRoleUuid}` +
          API_ENDPOINTS.CHECKING_ACCOUNTS.AVAILABILITY_SUFFIX,
      ),
      { params },
    );
  }
}
