import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../shared/components/currency-display/currency-display.component';
import { ProductChip } from '../../../shared/components/product-chip/product-chip';
import { ProductChipComponent } from '../../../shared/components/product-chip/product-chip.component';
import { LocalizedDatePipe } from '../../../shared/pipes/localized-date.pipe';
import { AuthService } from '../../auth/auth.service';
import { Permissions } from '../../auth/permissions';
import { productEditPath } from '../../product/product-page.paths';
import { OrderDto, OrderItemDto } from '../order-commit.model';
import { appliedPromotionsOf } from '../order-promotions';
import { OrdersApiService } from '../orders-api.service';
import { productCatalogStateChip, toProductCatalogState } from '../product-catalog-state';

/** Qué operación se está revisando: cambia a quién nombra el encabezado y cómo se titula. */
export type OrderDetailKind = 'purchase' | 'sale';

/**
 * Lo único que cambia entre una compra y una venta: a quién se nombra y cómo se titula. Es un mapa
 * y no dos condicionales porque un `kind` nuevo tiene que fallar al compilar, no salir con la
 * etiqueta de la venta.
 */
const LABELS_BY_KIND: Record<OrderDetailKind, { title: string; party: string }> = {
  purchase: { title: 'orders.detail.purchaseTitle', party: 'orders.detail.supplier' },
  sale: { title: 'orders.detail.saleTitle', party: 'orders.detail.customer' },
};

export interface OrderDetailDialogData {
  /**
   * La fila del paginado. Trae el encabezado entero —comprobante, fecha, contraparte, totales—, así
   * que el diálogo abre con todo eso escrito y sólo las líneas quedan cargando: el paginado **no**
   * las trae, y son lo único que hace falta ir a buscar.
   */
  order: OrderDto;
  kind: OrderDetailKind;
}

/** Una línea ya resuelta para la tabla: la línea del backend más el chip que le corresponde. */
interface DetailLine {
  item: OrderItemDto;
  name: string;
  /** El estado del catálogo, o `null` en el producto que sigue en circulación. */
  chip: ProductChip | null;
  /** La ficha del producto, o `null` si no se puede abrir —sin `uuid` o sin permiso—. */
  link: string | null;
}

/**
 * El comprobante, en sólo lectura: qué se compró o se vendió, a quién, cuándo y por cuánto.
 *
 * **Es la única pantalla que muestra las líneas de una operación cerrada.** El listado trae el
 * encabezado y nada más, y el formulario de compra sólo abre la orden borrador —una compra ya
 * aplicada no se edita por ningún camino, y una venta menos—. Sin esto, revisar qué tenía un
 * comprobante de hace seis meses no era posible desde el panel.
 *
 * **Vive en `core` porque es la misma pantalla para las dos features.** Compra y venta son la misma
 * tabla del backend y el mismo `OrderDTO`: lo único que cambia es a quién se nombra —proveedor o
 * cliente— y el título. Dos copias de esta tabla habrían divergido en la primera corrección.
 *
 * **Cada línea dice en qué estado quedó su producto.** El nombre que la línea muestra es el del
 * producto **vivo** —no un snapshot—, así que el histórico siempre mostró bien qué se vendió; lo que
 * no había era forma de saber que ese producto ya no está como estaba. El chip lo dice, distingue
 * archivado de discontinuado (ADR 0001) y **lleva a la ficha**: una marca que no se puede seguir es
 * peor que ninguna marca.
 */
@Component({
  selector: 'app-order-detail-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    LocalizedDatePipe,
    ProductChipComponent,
  ],
  providers: [OrdersApiService],
  templateUrl: './order-detail-dialog.component.html',
  styleUrl: './order-detail-dialog.component.css',
})
export class OrderDetailDialogComponent implements OnInit {
  private readonly ordersApi = inject(OrdersApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthService);

  protected readonly data = inject<OrderDetailDialogData>(MAT_DIALOG_DATA);

  /**
   * El encabezado arranca con la fila del listado y el detalle se **funde** encima cuando llega. No
   * se espera al detalle para dibujarlo: el usuario ya venía mirando esos mismos datos en la grilla,
   * y un diálogo en blanco le haría dudar de si abrió la fila que quería.
   */
  protected readonly order = signal<OrderDto>(this.data.order);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  /**
   * El enlace a la ficha se ofrece sólo con el permiso que guarda el área del catálogo. Un cajero ve
   * el indicador —que es lo que necesita para entender la línea— pero no un enlace que terminaría en
   * «sin permiso».
   */
  private readonly canOpenProduct = this.auth.hasPermission(Permissions.productBranchAssign);

  protected readonly lines = computed<readonly DetailLine[]>(() =>
    (this.order().items ?? []).map((item) => {
      const uuid = item.product?.uuid;
      const chip = productCatalogStateChip(toProductCatalogState(item.productState));

      return {
        item,
        name: item.product?.name ?? '',
        chip,
        // El enlace cuelga del chip, así que sin chip no hace falta resolverlo.
        link: chip && uuid && this.canOpenProduct ? productEditPath(uuid) : null,
      };
    }),
  );

  /** `true` si alguna línea quedó marcada: es lo que decide si la nota al pie tiene algo que decir. */
  protected readonly hasFlaggedLines = computed(() => this.lines().some((line) => line.chip));

  /**
   * El desglose de promociones de la venta, o `null` si no hubo ninguna.
   *
   * Sale del detalle —el paginado no lo trae—, así que hasta que la respuesta llega no hay sección,
   * que es lo correcto: una venta con descuentos no tiene por qué mostrarse primero sin ellos.
   *
   * La compra pasa por acá igual y siempre da `null`: el backend no le escribe promociones. Gatear
   * por `kind` sería decir dos veces lo mismo, y la segunda se olvidaría de actualizar.
   */
  protected readonly promotions = computed(() => appliedPromotionsOf(this.order()));

  protected readonly partyLabelKey = LABELS_BY_KIND[this.data.kind].party;
  protected readonly titleKey = LABELS_BY_KIND[this.data.kind].title;

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.ordersApi
      .getByUuid(this.data.order.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          // **Funde, no pisa.** El encabezado ya está dibujado con la fila del listado: un `set` lo
          // reemplazaría entero, y cualquier campo que el detalle no repita se vaciaría a la vista
          // del usuario. El spread sólo escribe las claves que el detalle trae.
          this.order.update((current) => ({ ...current, ...order }));
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  /** El `uuid` con el que la tabla sigue a cada fila; el índice reusaría mal el DOM al reintentar. */
  protected trackLine(index: number, line: DetailLine): string {
    return line.item.uuid ?? `${index}`;
  }

  /**
   * El nombre accesible del enlace del chip, ya interpolado con el producto. Leído fuera de la fila,
   * «Archivado» no dice adónde lleva ni de qué producto habla.
   */
  protected linkLabelKey(chip: ProductChip): string {
    return chip.id === 'archived'
      ? 'orders.detail.openArchivedProduct'
      : 'orders.detail.openDiscontinuedProduct';
  }
}

/**
 * Abre el detalle de un comprobante. Vive al lado del diálogo y no en cada listado porque el ancho,
 * el foco inicial y el tipo de los datos son los mismos en compras y en ventas: clonarlos era la
 * forma de que las dos pantallas terminaran abriendo diálogos distintos.
 */
export function openOrderDetailDialog(
  dialog: MatDialog,
  order: OrderDto,
  kind: OrderDetailKind,
): void {
  dialog.open<OrderDetailDialogComponent, OrderDetailDialogData>(OrderDetailDialogComponent, {
    width: '48rem',
    maxWidth: '95vw',
    autoFocus: 'first-heading',
    data: { order, kind },
  });
}
