import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PackagingDefaults } from './product-lookup.model';

/** Lo único que esta lectura mira del `ProductDTO`: la grilla de empaques declarados. */
interface ProductWithPackagings {
  packagings?: PackagingDefaults[] | null;
}

/**
 * Los empaques declarados de un producto, para las pantallas que cargan líneas en unidad base y
 * quieren ofrecer la conversión (RN-16).
 *
 * Existe porque **el paginado no los trae**: `ProductPaginateDTO` devuelve la ficha operativa y los
 * empaques viven en el detalle. Un producto elegido del buscador llega sin ellos, así que quien
 * quiera el selector tiene que pedirlos, y esta es la lectura mínima que hace falta —no el detalle
 * entero mapeado a un modelo de feature—.
 *
 * Vive en `core/` porque lo va a compartir más de una punta: la línea del traslado es la primera, y
 * el ajuste de stock tiene exactamente el mismo problema.
 */
@Service()
export class ProductPackagingsApiService {
  private readonly http = inject(HttpClient);

  /**
   * Los empaques del producto, o una lista vacía si no declara ninguno.
   *
   * Vacío y «no se leyeron» son cosas distintas y por eso esto no se cachea acá: quien llama decide
   * qué hacer mientras la lectura viaja. Mostrar un selector vacío diría que el producto no tiene
   * empaques cuando lo que pasa es que todavía no llegaron.
   */
  getPackagings(productUuid: string): Observable<readonly PackagingDefaults[]> {
    return this.http
      .get<ProductWithPackagings>(apiUrl(`${API_ENDPOINTS.PRODUCTS.BY_UUID}/${productUuid}`))
      .pipe(map((product) => product.packagings ?? []));
  }
}
