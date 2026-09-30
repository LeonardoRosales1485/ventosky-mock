import { Service } from '@angular/core';
import { REFRESH_TOKEN_KEY, TOKEN_KEY } from './local-storage-keys.constants';

/**
 * Lo que se guarda para todo el navegador: la sesión, y las preferencias que no dependen de dónde
 * se está operando.
 *
 * El contexto de operación —empresa, sucursal, caja— **no se lee de acá**: es de cada tab y lo sirve
 * `TabContextStore`, que usa este storage sólo como semilla para los tabs que se abran. Por eso este
 * servicio no tiene accesores para esas claves: leerlas derecho de acá devolvería la última elección
 * de cualquier tab, no la del que está preguntando.
 */
@Service()
export class LocalStorageService {
  public getItem(key: string): string | null {
    return localStorage.getItem(key);
  }

  public setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  public removeItem(key: string): void {
    localStorage.removeItem(key);
  }

  public clear(): void {
    localStorage.clear();
  }

  /** Las claves guardadas, para quien necesite recorrerlas por prefijo. */
  public keys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key !== null) {
        keys.push(key);
      }
    }
    return keys;
  }

  public getToken(): string | null {
    return this.getItem(TOKEN_KEY);
  }

  public getRefreshToken(): string | null {
    return this.getItem(REFRESH_TOKEN_KEY);
  }

  public setToken(token: string): void {
    this.setItem(TOKEN_KEY, token);
  }

  public setRefreshToken(refreshToken: string): void {
    this.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }

  public removeToken(): void {
    this.removeItem(TOKEN_KEY);
  }

  public removeRefreshToken(): void {
    this.removeItem(REFRESH_TOKEN_KEY);
  }
}
