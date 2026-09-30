import { Injectable, inject } from '@angular/core';
import { LocalStorageService } from '../../../core/local-storage/local-storage.service';

/**
 * Cómo entra la mercadería al carrito de la compra.
 *
 * - `scan`: carga directa. Cada Enter es una lectura de código exacto y el producto se agrega solo.
 * - `search`: autocompletado por nombre, SKU o código, y se elige de la lista.
 */
export type PurchaseSearchMode = 'scan' | 'search';

/**
 * Con qué modo arranca la pantalla mientras nadie haya elegido otro.
 *
 * Al revés del mostrador, acá el default es `search`: una compra se carga desde el remito o la
 * factura del proveedor, leyendo nombres, y no pasando la mercadería por el lector.
 */
export const DEFAULT_PURCHASE_SEARCH_MODE: PurchaseSearchMode = 'search';

/** Clave propia: el modo de la compra se elige por separado del de la venta. */
const STORAGE_KEY = 'ventosky.purchases.searchMode';

/**
 * El modo de carga elegido, recordado entre recargas.
 *
 * Se guarda sin sucursal ni usuario a propósito: lo que decide el modo es si **esta** máquina tiene
 * un lector colgado, y eso no cambia porque se cambie de contexto o de turno.
 */
@Injectable()
export class PurchaseSearchModeStore {
  private readonly storage = inject(LocalStorageService);

  read(): PurchaseSearchMode {
    const stored = this.storage.getItem(STORAGE_KEY);
    return stored === 'scan' || stored === 'search' ? stored : DEFAULT_PURCHASE_SEARCH_MODE;
  }

  write(mode: PurchaseSearchMode): void {
    this.storage.setItem(STORAGE_KEY, mode);
  }
}
