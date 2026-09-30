import { Service, inject } from '@angular/core';
import { CASH_REGISTER_KEY_PREFIX } from '../tab-context/tab-context-keys.constants';
import { TabContextStore } from '../tab-context/tab-context.store';

/**
 * La caja con la que se está operando, recordada entre recargas.
 *
 * Es contexto de request y no sólo una preferencia de pantalla: de acá sale el header
 * `X-Cash-Register-Uuid` (ver `core/http/cash-register.interceptor.ts`). Por eso las pantallas
 * guardan también la caja que resolvieron solas —la preasignada, la única abierta— y no únicamente
 * la que el operador eligió del menú: si no quedara registrada, el header no viajaría justo en el
 * caso más común.
 *
 * La clave lleva la sucursal porque una caja pertenece a una: recordarla globalmente le devolvería
 * al operador una caja de otra sucursal después de cambiar de contexto, y el backend la rechazaría
 * por no pertenecer a la sucursal activa.
 *
 * Va por `TabContextStore` y no derecho a localStorage porque la caja es de este tab, igual que la
 * sucursal: dos tabs parados en la misma sucursal pueden estar cobrando por cajas distintas, y con
 * una sola copia compartida el header de uno saldría con la caja del otro.
 */
@Service()
export class SelectedCashRegisterStore {
  private readonly tabContext = inject(TabContextStore);

  read(branchUuid: string | null): string | null {
    return branchUuid ? this.tabContext.getItem(this.key(branchUuid)) : null;
  }

  /**
   * La caja del contexto actual: la recordada para la sucursal de **este tab**. Es lo que viaja en
   * el header, y la sucursal se lee del contexto del tab —no de `AuthService`— para no atar el
   * interceptor al ciclo de vida de la sesión.
   */
  current(): string | null {
    return this.read(this.tabContext.getBranchUuid());
  }

  write(branchUuid: string | null, cashRegisterUuid: string): void {
    if (branchUuid) {
      this.tabContext.setItem(this.key(branchUuid), cashRegisterUuid);
    }
  }

  private key(branchUuid: string): string {
    return `${CASH_REGISTER_KEY_PREFIX}${branchUuid}`;
  }
}
