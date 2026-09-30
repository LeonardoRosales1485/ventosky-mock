import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import {
  PartyContactDto,
  PartyContactSavePayload,
  PartyDocType,
  PartyDto,
  PartyUserLinkRequest,
} from './party.model';

/**
 * Lo que se hace sobre el maestro de terceros y no pertenece a la ficha de ningún vínculo: buscar sobre **todo**
 * el maestro, los contactos de la identidad y el vínculo de la ficha con su usuario.
 *
 * La búsqueda es lo que convierte el 409 «ese documento ya existe» en una pregunta que el usuario puede
 * contestar: *«Juan Pérez ya está cargado como proveedor, ¿le sumo el vínculo de cliente?»*. Sumárselo es el
 * alta del vínculo con su `partyUuid`, no una llamada de acá.
 */
@Service()
export class PartiesApiService {
  private readonly http = inject(HttpClient);

  /**
   * Busca por documento exacto sobre todo el maestro, sin filtrar por rol. Devuelve a lo sumo un
   * tercero: el documento es único por empresa.
   */
  searchByDocument(docType: PartyDocType, docNumber: string): Observable<PartyDto[]> {
    return this.http.post<PartyDto[]>(apiUrl(API_ENDPOINTS.PARTIES.SEARCH), { docType, docNumber });
  }

  /** Busca por texto libre sobre nombre y número de documento. */
  searchByTerm(term: string): Observable<PartyDto[]> {
    return this.http.post<PartyDto[]>(apiUrl(API_ENDPOINTS.PARTIES.SEARCH), { term });
  }

  getByUuid(uuid: string): Observable<PartyDto> {
    return this.http.get<PartyDto>(apiUrl(`${API_ENDPOINTS.PARTIES.BY_UUID}/${uuid}`));
  }

  listContacts(partyUuid: string): Observable<PartyContactDto[]> {
    return this.http.get<PartyContactDto[]>(
      apiUrl(`${API_ENDPOINTS.PARTIES.CONTACTS}/${partyUuid}/contacts`),
    );
  }

  saveContact(contact: PartyContactSavePayload): Observable<PartyContactDto> {
    return this.http.post<PartyContactDto>(apiUrl(API_ENDPOINTS.PARTIES.CONTACT_SAVE), contact);
  }

  deleteContact(uuid: string): Observable<PartyContactDto> {
    return this.http.delete<PartyContactDto>(
      apiUrl(`${API_ENDPOINTS.PARTIES.CONTACT_DELETE}/${uuid}`),
    );
  }

  /**
   * Vincula la ficha con su usuario —uno nuevo o uno que ya existe— y le agrega roles en la empresa
   * activa. No toca los datos de la persona ni los vínculos del usuario con otras empresas.
   */
  linkUser(partyUuid: string, request: PartyUserLinkRequest): Observable<PartyDto> {
    return this.http.post<PartyDto>(apiUrl(API_ENDPOINTS.PARTIES.USER(partyUuid)), request);
  }

  /** Deja la ficha sin usuario. **No le saca el acceso**: el usuario y sus roles quedan como estaban. */
  unlinkUser(partyUuid: string): Observable<PartyDto> {
    return this.http.delete<PartyDto>(apiUrl(API_ENDPOINTS.PARTIES.USER(partyUuid)));
  }
}
