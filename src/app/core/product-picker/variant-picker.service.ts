import { HttpClient } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, map, of, switchMap } from 'rxjs';
import { API_ENDPOINTS, apiUrl } from '../http/api.config';
import { PaginationData } from '../paginate';
import { PickerProduct } from './product-picker.model';
import {
  VariantPickerDialogComponent,
  VariantPickerDialogData,
} from './variant-picker-dialog.component';

/**
 * Abre el selector de variante de un modelo. Lo comparten el POS y las compras, y por eso vive en
 * `core/`: son dos pantallas de features distintas haciendo el mismo gesto.
 *
 * **No lo usa el escaneo.** Un código de barras resuelve la variante directo (RN-12: el modelo no
 * tiene código), así que ese camino no llega hasta acá y el mostrador no pierde velocidad.
 */
@Service()
export class VariantPickerService {
  private readonly dialog = inject(MatDialog);
  private readonly http = inject(HttpClient);

  /**
   * Pide las variantes del modelo y deja elegir una. Devuelve `null` si se cerró sin elegir.
   *
   * Con **una sola** variante activa no abre nada y la devuelve: preguntar por una única opción es
   * un clic que no decide nada.
   */
  pickFromModel(modelUuid: string, modelName: string): Observable<PickerProduct | null> {
    return this.variantsOf(modelUuid).pipe(
      switchMap((variants) => {
        if (variants.length === 0) {
          return of(null);
        }
        if (variants.length === 1) {
          return of(variants[0]);
        }
        return this.open({ modelName, variants });
      }),
    );
  }

  /**
   * Las variantes activas de un modelo, con su stock y sus precios en la sucursal activa.
   *
   * Va por el paginado operativo y no por `/product-model/uuid`: lo que hace falta es la **fila del
   * producto** —la misma que devuelve el buscador— para poder armar la línea sin volver a pedir
   * nada. Y de paso hereda el acotado por sucursal, que es lo que evita ofrecer en un mostrador una
   * variante que ese mostrador no tiene.
   */
  variantsOf(modelUuid: string): Observable<PickerProduct[]> {
    return this.http
      .post<PaginationData<PickerProduct>>(apiUrl(API_ENDPOINTS.PRODUCTS.PAGINATE), {
        page: 1,
        size: 200,
        relaciones: [
          {
            tipo: 'inner',
            desdeTabla: 't',
            desdeColumna: 'id_model',
            hastaTabla: 'product_models',
            hastaColumna: 'id',
          },
        ],
        filtros: [[{ tabla: 'product_models', columna: 'uuid', operacion: '=', valor: modelUuid }]],
      })
      .pipe(map((data) => data.content ?? []));
  }

  /** Abre el selector con variantes ya cargadas, para quien las tiene de antes. */
  open(data: VariantPickerDialogData): Observable<PickerProduct | null> {
    return this.dialog
      .open<VariantPickerDialogComponent, VariantPickerDialogData, PickerProduct>(
        VariantPickerDialogComponent,
        {
          width: '34rem',
          maxWidth: '95vw',
          maxHeight: '90vh',
          autoFocus: 'first-tabbable',
          data,
        },
      )
      .afterClosed()
      .pipe(map((variant) => variant ?? null));
  }
}
