import { Service, inject } from '@angular/core';
import { LocalStorageService } from '../local-storage/local-storage.service';
import {
  BRANCH_UUID_KEY,
  CASH_REGISTER_KEY_PREFIX,
  COMPANY_UUID_KEY,
  TAB_SEALED_KEY,
} from './tab-context-keys.constants';

/**
 * El contexto con el que opera **este tab**: empresa, sucursal y caja.
 *
 * Las tres viajan en cada request (`X-Company-Uuid`, `X-Branch-Uuid`, `X-Cash-Register-Uuid`) y
 * deciden qué contesta casi toda la API, así que guardarlas en localStorage —compartido por todos
 * los tabs del mismo origen— hacía imposible tener dos sucursales abiertas a la vez: el último
 * cambio se lo llevaba puesto el otro tab en su próximo request, y con él la sucursal contra la que
 * ese tab estaba cargando stock o cobrando. El valor vigente pasa entonces a `sessionStorage`, que
 * es de un tab y sobrevive a la recarga: la de `switchBranch` y la tecla F5.
 *
 * En localStorage queda una **semilla**, el mismo contexto escrito en paralelo, y es lo que hereda
 * un tab nuevo la primera vez que pregunta. Así abrir la app en otro tab sigue cayendo en la
 * sucursal que se venía usando, sin pantalla de selección extra, y desde ahí cada tab es dueño del
 * suyo.
 *
 * La sesión —el token— sigue siendo una sola para todos: los tabs comparten el usuario, no la
 * sucursal.
 */
@Service()
export class TabContextStore {
  /** La semilla: el contexto que heredarán los tabs que se abran de acá en más. */
  private readonly seed = inject(LocalStorageService);

  private sealed = false;

  public getCompanyUuid(): string | null {
    return this.getItem(COMPANY_UUID_KEY);
  }

  public getBranchUuid(): string | null {
    return this.getItem(BRANCH_UUID_KEY);
  }

  public setCompanyUuid(companyUuid: string): void {
    this.setItem(COMPANY_UUID_KEY, companyUuid);
  }

  public setBranchUuid(branchUuid: string): void {
    this.setItem(BRANCH_UUID_KEY, branchUuid);
  }

  public removeCompanyUuid(): void {
    this.removeItem(COMPANY_UUID_KEY);
  }

  public removeBranchUuid(): void {
    this.removeItem(BRANCH_UUID_KEY);
  }

  /**
   * La caja se recuerda por sucursal, así que su clave no es fija y no puede tener un accesor
   * propio. `SelectedCashRegisterStore` es el único que las arma.
   */
  public getItem(key: string): string | null {
    this.seal();
    return sessionStorage.getItem(key);
  }

  /** Escribe el valor de este tab y actualiza la semilla para los que vengan. */
  public setItem(key: string, value: string): void {
    this.seal();
    sessionStorage.setItem(key, value);
    this.seed.setItem(key, value);
  }

  /**
   * Saca el valor de los dos lados. Se borra porque dejó de ser válido —cambió la empresa, se cerró
   * la sesión—, y un contexto inválido no es algo que convenga heredarle a nadie. Los tabs que ya
   * fijaron el suyo no se enteran: leen el de su `sessionStorage`.
   */
  public removeItem(key: string): void {
    this.seal();
    sessionStorage.removeItem(key);
    this.seed.removeItem(key);
  }

  /** Cierre de sesión: la empresa y la sucursal se van; la caja recordada por sucursal se queda. */
  public clear(): void {
    this.removeItem(COMPANY_UUID_KEY);
    this.removeItem(BRANCH_UUID_KEY);
  }

  /**
   * Fija el contexto del tab copiando la semilla, una única vez.
   *
   * Lo dispara el propio accesor y no el arranque de la aplicación: el primero en preguntar por el
   * contexto puede ser el `authInterceptor` —la carga de las traducciones sale antes de que exista
   * `AuthService`— o `AuthService` mismo. Sellando desde adentro de la lectura, el orden deja de
   * importar; moverlo a un inicializador volvería a atarlo.
   *
   * Se copia **el grupo entero** y no cada clave cuando alguien la pide: si otro tab cambiara de
   * sucursal en el medio, una herencia clave por clave armaría un contexto mezclado, con la empresa
   * de antes y la sucursal de después.
   *
   * Lo que el tab ya tenga en `sessionStorage` gana sobre la semilla. Chrome y Firefox lo copian al
   * duplicar un tab o al abrir un enlace con Ctrl+clic, y ahí lo correcto es quedarse en la sucursal
   * del tab de origen, no en la última usada en cualquier otro lado.
   */
  private seal(): void {
    if (this.sealed) {
      return;
    }
    this.sealed = true;

    // La marca va en `sessionStorage` y no sólo en memoria: si no, una recarga volvería a heredar y
    // le devolvería al tab una sucursal que él mismo acababa de descartar.
    if (sessionStorage.getItem(TAB_SEALED_KEY) !== null) {
      return;
    }

    for (const key of this.inheritableKeys()) {
      const value = this.seed.getItem(key);
      if (value !== null && sessionStorage.getItem(key) === null) {
        sessionStorage.setItem(key, value);
      }
    }

    sessionStorage.setItem(TAB_SEALED_KEY, '1');
  }

  /** La empresa, la sucursal, y la caja recordada de cada sucursal. */
  private inheritableKeys(): string[] {
    return [
      COMPANY_UUID_KEY,
      BRANCH_UUID_KEY,
      ...this.seed.keys().filter((key) => key.startsWith(CASH_REGISTER_KEY_PREFIX)),
    ];
  }
}
