import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  AttributeValueType,
  isAttributeValueType,
} from '../../../core/attributes/attribute-value-type';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { UuidNameRef } from '../../../core/http/api-refs';
import { PaginationData } from '../../../core/paginate';

/** Los catálogos que usan los formularios son chicos: se traen enteros en vez de paginarlos. */
const OPTIONS_PAGE_SIZE = 500;

export interface DirectoryPriceListOption extends UuidNameRef {
  isPrincipal?: boolean | null;
  isActive?: boolean | null;
  isCost?: boolean | null;
}

export interface DirectoryAttributeOption extends UuidNameRef {
  type: AttributeValueType;
}

/**
 * Las opciones de los selects del directorio: listas de precios, roles y los campos extra de empleado de la
 * empresa. Cada lectura pide su propio permiso, así que el formulario tolera que alguna falle: sin permiso
 * sobre las listas, por ejemplo, el vendedor se da de alta igual y su lista queda para después.
 */
@Injectable()
export class DirectoryCatalogApiService {
  private readonly http = inject(HttpClient);

  /**
   * Las listas con las que se puede vender: activas y sin la de costo, que el backend rechaza tanto como lista
   * de un cliente como lista con la que cotiza un vendedor.
   */
  priceLists(): Observable<DirectoryPriceListOption[]> {
    return this.all<DirectoryPriceListOption>(API_ENDPOINTS.PRICE_LISTS.PAGINATE).pipe(
      map((lists) => lists.filter((list) => list.isCost !== true && list.isActive !== false)),
    );
  }

  /** Los roles que la empresa puede asignar: los suyos y los de sistema. Es lo que ofrece «+ agregar». */
  roles(): Observable<UuidNameRef[]> {
    return this.all<UuidNameRef>(API_ENDPOINTS.ROLES.PAGINATE).pipe(
      map((roles) => roles.map((role) => ({ uuid: role.uuid, name: role.name }))),
    );
  }

  /**
   * Los campos extra de empleado que definió la empresa. Un tipo que el front no conoce se trata como texto:
   * el backend valida el valor contra el tipo real igual.
   */
  employeeAttributes(): Observable<DirectoryAttributeOption[]> {
    return this.all<{ uuid: string; name: string; type: string }>(
      API_ENDPOINTS.EMPLOYEE_ATTRIBUTES.PAGINATE,
    ).pipe(
      map((attributes) =>
        attributes.map((attribute) => ({
          uuid: attribute.uuid,
          name: attribute.name,
          type: isAttributeValueType(attribute.type) ? attribute.type : 'text',
        })),
      ),
    );
  }

  private all<T>(endpoint: string): Observable<T[]> {
    return this.http
      .post<PaginationData<T>>(apiUrl(endpoint), { page: 1, size: OPTIONS_PAGE_SIZE })
      .pipe(map((page) => page.content ?? []));
  }
}
