import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { ProductCodeLookup, ProductLookupMode } from './product-lookup.model';

/**
 * Resolver lo que leyó el escáner (`GET /product/by-barcode`).
 *
 * Vive en `core` porque lo comparten el punto de venta y la carga de una compra, que son las dos
 * puntas donde entra mercadería por lector. Un `*ApiService` de feature no sirve: los proveen sus
 * propias pantallas, así que importarlo desde otra feature compila y muere en runtime con `NG0201`.
 *
 * Es **una** entrada para las tres lecturas —el código del producto, el de una de sus cajas y la
 * etiqueta de balanza— porque el mostrador no sabe cuál es hasta que pasa el producto por el lector.
 * Quién decide es el backend: es el único que conoce el formato de la balanza de la empresa.
 */
@Service()
export class ProductLookupApiService {
  private readonly http = inject(HttpClient);

  /**
   * El producto que se lee con `code`, con el factor del empaque o la cantidad de la etiqueta ya
   * resueltos. El producto llega con el mismo enriquecimiento que el detalle —stock, precios y costo
   * de la sucursal activa—, así que la línea se arma sin una segunda lectura.
   *
   * Errores que el llamador tiene que distinguir:
   * - `404 PRODUCT_NOT_FOUND` — ningún producto activo de la empresa se lee con ese código, o la
   *   sucursal activa no lo ofrece (es el mismo 404, para no confirmarlo).
   * - `400 SCALE_FORMAT_NOT_CONFIGURED` — sólo con `mode: 'SCALE'`: la empresa no configuró
   *   `sale.scaleBarcodeFormat`. Es un error de configuración, no de datos.
   *
   * @param mode `SCALE` para una lectura que el operador declaró etiqueta de balanza. Omitido, el
   *   backend usa `AUTO`: prueba etiqueta y después código de barras.
   */
  resolve<TProduct>(
    code: string,
    mode?: ProductLookupMode,
  ): Observable<ProductCodeLookup<TProduct>> {
    return this.http.get<ProductCodeLookup<TProduct>>(
      apiUrl(API_ENDPOINTS.PRODUCTS.BY_BARCODE),
      { params: mode ? { code, mode } : { code } },
    );
  }
}
