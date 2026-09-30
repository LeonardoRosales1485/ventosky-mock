import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { skipGlobalProgress } from '../../../core/http/skip-global-progress';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import { DirectoryLink } from '../../../core/parties/directory-links';
import { DirectoryFolderId, directoryFolder } from './directory-folders';
import {
  DirectoryProfileDto,
  DirectoryRow,
  DirectoryUserDto,
  EmployeeAttributeValueDto,
  EmployeeProfileDto,
  EmployeeSpecialtyDto,
  OnboardRequest,
  SuggestedRoleDto,
} from './directory.model';

/** Los endpoints del ABM de cada vínculo. */
const LINK_ENDPOINTS = {
  CUSTOMER: API_ENDPOINTS.CUSTOMERS,
  SUPPLIER: API_ENDPOINTS.SUPPLIERS,
  SELLER: API_ENDPOINTS.SELLERS,
  BUYER: API_ENDPOINTS.BUYERS,
  TRANSPORTIST: API_ENDPOINTS.TRANSPORTISTS,
} as const satisfies Record<DirectoryLink, unknown>;

/** Qué pagina cada carpeta. Las de un vínculo, su ABM; las otras tres, lo que listan. */
function paginateEndpoint(folder: DirectoryFolderId): string {
  const create = directoryFolder(folder).create;
  if (create.kind === 'form') {
    return LINK_ENDPOINTS[create.link].PAGINATE;
  }
  if (folder === 'employees') {
    return API_ENDPOINTS.EMPLOYEES.PAGINATE;
  }
  if (folder === 'access') {
    return API_ENDPOINTS.USERS.PAGINATE;
  }
  return API_ENDPOINTS.PARTIES.PAGINATE;
}

/**
 * Lo que el directorio le pide al backend: el listado de cada carpeta, las fichas de cada vínculo con su alta
 * compuesta, y la ficha general del empleado con sus especialidades y campos extra.
 */
@Injectable()
export class DirectoryApiService {
  private readonly http = inject(HttpClient);

  paginate(
    folder: DirectoryFolderId,
    query: PaginateQuery,
  ): Observable<PaginationData<DirectoryRow>> {
    return this.http.post<PaginationData<DirectoryRow>>(apiUrl(paginateEndpoint(folder)), query);
  }

  /**
   * Cuántas filas tiene la carpeta, con sus filtros por defecto. Es una página de un elemento: el total ya lo
   * cuenta el backend. No mueve la barra de progreso global, que se dispararía una vez por carpeta.
   */
  count(folder: DirectoryFolderId): Observable<number> {
    return this.http
      .post<PaginationData<DirectoryRow>>(
        apiUrl(paginateEndpoint(folder)),
        { page: 1, size: 1 },
        { context: skipGlobalProgress() },
      )
      .pipe(map((page) => page.totalElements ?? 0));
  }

  getProfile<T extends DirectoryProfileDto>(link: DirectoryLink, uuid: string): Observable<T> {
    return this.http.get<T>(apiUrl(`${LINK_ENDPOINTS[link].BY_UUID}/${uuid}`));
  }

  saveProfile<T extends DirectoryProfileDto>(
    link: DirectoryLink,
    profile: Record<string, unknown>,
  ): Observable<T> {
    return this.http.post<T>(apiUrl(LINK_ENDPOINTS[link].SAVE), profile);
  }

  /** El alta compuesta: la ficha, sus contactos, los campos extra y el usuario, en una transacción. */
  onboard<T extends DirectoryProfileDto>(
    link: DirectoryLink,
    request: OnboardRequest,
  ): Observable<T> {
    return this.http.post<T>(apiUrl(LINK_ENDPOINTS[link].ONBOARD), request);
  }

  /**
   * Borra la ficha del vínculo. En cliente y proveedor da de baja ese rol; en un tipo de empleado **revoca esa
   * especialidad**, y el empleado sigue siéndolo con las demás.
   */
  deleteProfile(link: DirectoryLink, uuid: string): Observable<unknown> {
    return this.http.delete(apiUrl(`${LINK_ENDPOINTS[link].DELETE}/${uuid}`));
  }

  /** Los roles que el bloque de acceso sugiere para el vínculo, cada uno con `grantable`. */
  suggestedRoles(link: DirectoryLink): Observable<SuggestedRoleDto[]> {
    return this.http.get<SuggestedRoleDto[]>(apiUrl(LINK_ENDPOINTS[link].SUGGESTED_ROLES));
  }

  getEmployee(uuid: string): Observable<EmployeeProfileDto> {
    return this.http.get<EmployeeProfileDto>(apiUrl(`${API_ENDPOINTS.EMPLOYEES.BY_UUID}/${uuid}`));
  }

  /** Edita la ficha general. No da de alta: el alta es siempre por tipo. */
  saveEmployee(profile: Record<string, unknown>): Observable<EmployeeProfileDto> {
    return this.http.post<EmployeeProfileDto>(apiUrl(API_ENDPOINTS.EMPLOYEES.SAVE), profile);
  }

  /** Da de baja al empleado entero, con sus especialidades y sus campos extra. */
  deleteEmployee(uuid: string): Observable<unknown> {
    return this.http.delete(apiUrl(`${API_ENDPOINTS.EMPLOYEES.DELETE}/${uuid}`));
  }

  specialties(employeeUuid: string): Observable<EmployeeSpecialtyDto[]> {
    return this.http.get<EmployeeSpecialtyDto[]>(
      apiUrl(API_ENDPOINTS.EMPLOYEES.SPECIALTIES(employeeUuid)),
    );
  }

  /**
   * Le suma una especialidad a alguien que ya es empleado, con los datos de ese tipo. El legajo, el ingreso y la
   * sucursal ya los tiene: son del empleado, no de la especialidad. Revocada antes, revive con sus datos, y el
   * bloque que viaja los reemplaza.
   */
  grantSpecialty(
    employeeUuid: string,
    body: Record<string, unknown>,
  ): Observable<EmployeeSpecialtyDto> {
    return this.http.post<EmployeeSpecialtyDto>(
      apiUrl(API_ENDPOINTS.EMPLOYEES.GRANT_SPECIALTY(employeeUuid)),
      body,
    );
  }

  /** Reemplaza el set completo de campos extra del empleado: lo que no viaja se da de baja. */
  replaceAttributes(
    employeeUuid: string,
    values: { attributeUuid: string; value: string }[],
  ): Observable<EmployeeAttributeValueDto[]> {
    return this.http.put<EmployeeAttributeValueDto[]>(
      apiUrl(API_ENDPOINTS.EMPLOYEES.ATTRIBUTES(employeeUuid)),
      values,
    );
  }

  /** El usuario completo, con sus roles en la empresa activa. */
  getUser(uuid: string): Observable<DirectoryUserDto> {
    return this.http.get<DirectoryUserDto>(apiUrl(`${API_ENDPOINTS.USERS.BY_UUID}/${uuid}`));
  }
}
