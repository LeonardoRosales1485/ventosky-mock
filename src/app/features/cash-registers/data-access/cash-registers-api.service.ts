import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../../../core/http/api.config';
import { PaginateQuery, PaginationData } from '../../../core/paginate';
import {
  CashRegisterDto,
  CashRegisterSavePayload,
  CashRegisterUserOption,
} from './cash-register.model';

/** Los usuarios de una empresa entran de sobra en una página: el select los trae enteros. */
const OPTIONS_PAGE_SIZE = 500;

@Injectable()
export class CashRegistersApiService {
  private readonly http = inject(HttpClient);

  /** Cajas de la empresa activa (`X-Company-Uuid`), de todas sus sucursales. */
  paginate(query: PaginateQuery): Observable<PaginationData<CashRegisterDto>> {
    return this.http.post<PaginationData<CashRegisterDto>>(
      apiUrl(API_ENDPOINTS.CASH_REGISTERS.PAGINATE),
      query,
    );
  }

  getByUuid(uuid: string): Observable<CashRegisterDto> {
    return this.http.get<CashRegisterDto>(
      apiUrl(`${API_ENDPOINTS.CASH_REGISTERS.BY_UUID}/${uuid}`),
    );
  }

  save(cashRegister: CashRegisterSavePayload): Observable<CashRegisterDto> {
    return this.http.post<CashRegisterDto>(apiUrl(API_ENDPOINTS.CASH_REGISTERS.SAVE), cashRegister);
  }

  delete(uuid: string): Observable<CashRegisterDto> {
    return this.http.delete<CashRegisterDto>(
      apiUrl(`${API_ENDPOINTS.CASH_REGISTERS.DELETE}/${uuid}`),
    );
  }

  /**
   * Usuarios de la empresa activa para el select de preasignación. `/user/paginate` ya acota por
   * `X-Company-Uuid`, así que la lista es exactamente la que el backend acepta asignar.
   */
  listUsers(pageSize = OPTIONS_PAGE_SIZE): Observable<CashRegisterUserOption[]> {
    return this.http
      .post<PaginationData<CashRegisterUserOption>>(apiUrl(API_ENDPOINTS.USERS.PAGINATE), {
        page: 1,
        size: pageSize,
        ordenes: [{ tabla: 't', columna: 'username', direccion: 'ASC' }],
      })
      .pipe(map((page) => page.content ?? []));
  }
}
