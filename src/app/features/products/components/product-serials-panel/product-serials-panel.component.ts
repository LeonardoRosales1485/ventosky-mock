import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import {
  ProductSerialDto,
  ProductSerialsDto,
  SERIAL_STATES,
  SerialState,
  serialLookupPath,
} from '../../../../core/stock/stock-serial.model';
import { StockSerialsApiService } from '../../../../core/stock/stock-serials-api.service';
import { NEW_PURCHASE_PATH, PURCHASES_PATH } from '../../../purchases/purchases.paths';
import { SALES_PATH } from '../../../sales/sales.paths';

/**
 * Cuántas unidades muestra la grilla antes de plegarse en «…N series más» (wireframe `1f`). El
 * backend devuelve todas las unidades del producto —no pagina—, y un producto de electro puede
 * tener cientos vendidas: el filtro por estado y el buscador son el camino normal para llegar a una,
 * y desplegar el resto es un click.
 */
export const SERIAL_ROW_LIMIT = 50;

/** Las dos acciones de postventa sobre una unidad, las mismas de la consulta por serie (`1q`). */
type SerialAction = 'return' | 'reinstate';

/**
 * Las unidades de un producto `stock_tracking = SERIAL` (§9, wireframe `1f`): el buscador por
 * número, los contadores por estado, la grilla con su trazabilidad y el chequeo de consistencia.
 *
 * Vive fuera de la solapa Stock —y no como una rama más de su plantilla— porque es **otra
 * pantalla**: donde un producto por cantidad o por lote muestra un formulario de ajuste con un panel
 * al lado, uno serializado muestra una grilla a todo el ancho y **ningún ajuste**. El saldo de un
 * serializado lo mueven las unidades, y un ajuste lo correría sin tocarlas.
 *
 * El componente **no lee las unidades**: se las pasa la solapa, que ya agrupa sus lecturas en un
 * `forkJoin`. Sí ejecuta las dos acciones de postventa, y avisa con {@link changed} para que quien
 * tiene los datos los vuelva a leer.
 */
@Component({
  selector: 'app-product-serials-panel',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './product-serials-panel.component.html',
  styleUrl: './product-serials-panel.component.css',
})
export class ProductSerialsPanelComponent {
  private readonly serialsApi = inject(StockSerialsApiService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** Las unidades tal como las devolvió `GET /stock/serials/{p}`, con sus contadores. */
  readonly serials = input<ProductSerialsDto | null>(null);

  /** Una acción de postventa terminó bien: el saldo y las unidades hay que releerlos. */
  readonly changed = output<void>();

  /**
   * La consulta por serie devuelve el **contacto del cliente**, así que el número sólo se linkea —y
   * el menú de la fila sólo se ofrece— a quien puede abrirla. La grilla en sí va con `stock.view`:
   * ahí no hay ningún dato del cliente.
   */
  protected readonly canViewSerial = this.auth.hasPermission(Permissions.stockSerialView);
  /** Reingresar **mueve el saldo**: postventa más inventario, en ese orden (§3.5 del flujo 35). */
  protected readonly canReinstate =
    this.canViewSerial && this.auth.hasPermission(Permissions.stockAdjustment);
  /** «Cargar series» lleva a una compra nueva, que es la pantalla que pide los números (§9). */
  protected readonly canCreatePurchase = this.auth.hasPermission(Permissions.purchaseCreate);
  /** «Ingresó con» abre el listado de compras filtrado por el número de la operación. */
  protected readonly canViewPurchases = this.auth.hasPermission(Permissions.purchaseView);

  /**
   * Estado por el que filtra la grilla. Se filtra del lado del cliente porque el conjunto es chico
   * por definición —son las unidades de un producto— y porque los cuatro contadores tienen que
   * verse aunque el filtro deje una sola fila.
   */
  protected readonly stateFilter = signal<SerialState>('IN_STOCK');
  /** Búsqueda por número dentro de la grilla: es un lector de código de barras tipeando. */
  protected readonly search = signal('');
  /** Si la grilla desplegó las filas que pasan de {@link SERIAL_ROW_LIMIT}. */
  protected readonly showAll = signal(false);
  /** El número de la unidad con una acción en vuelo, o `null`. Apaga los menús. */
  protected readonly pending = signal<string | null>(null);

  protected readonly serialStates = SERIAL_STATES;
  protected readonly serialPath = serialLookupPath;
  protected readonly newPurchasePath = NEW_PURCHASE_PATH;
  protected readonly purchasesPath = PURCHASES_PATH;
  protected readonly salesPath = SALES_PATH;

  /** Cuántas unidades hay en cada estado, para los chips del filtro. */
  protected readonly counts = computed<Record<SerialState, number>>(() => {
    const data = this.serials();
    return {
      IN_STOCK: data?.inStockCount ?? 0,
      SOLD: data?.soldCount ?? 0,
      RETURNED: data?.returnedCount ?? 0,
      IN_TRANSIT: data?.inTransitCount ?? 0,
      SCRAPPED: data?.scrappedCount ?? 0,
    };
  });

  /** Las unidades que pasan el filtro: el estado elegido, acotado por el buscador. */
  private readonly filtered = computed<readonly ProductSerialDto[]>(() => {
    const rows = this.serials()?.rows ?? [];
    const state = this.stateFilter();
    const search = this.search().trim().toUpperCase();
    return rows.filter(
      (row) => row.state === state && (!search || row.serialNumber.toUpperCase().includes(search)),
    );
  });

  /** Las filas que la grilla dibuja: las filtradas, plegadas en {@link SERIAL_ROW_LIMIT}. */
  protected readonly visible = computed<readonly ProductSerialDto[]>(() => {
    const rows = this.filtered();
    return this.showAll() ? rows : rows.slice(0, SERIAL_ROW_LIMIT);
  });

  /** Cuántas filas quedaron plegadas: es el número de «…N series más». */
  protected readonly hiddenCount = computed(() => this.filtered().length - this.visible().length);

  /** El chip de estado. Cambiar de conjunto vuelve a plegar: el «más» era del anterior. */
  protected onStateFilter(state: SerialState): void {
    this.stateFilter.set(state);
    this.showAll.set(false);
  }

  /** El buscador de la grilla. Es un `input` suelto: filtra, no valida nada. */
  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.showAll.set(false);
  }

  /**
   * Registrar la devolución de una unidad vendida, desde la fila. Es la misma acción —y la misma
   * confirmación— que la consulta por serie (`1q`): la unidad queda apartada, **no** vuelve al stock
   * vendible y el saldo no cambia.
   */
  protected onRegisterReturn(serial: ProductSerialDto): void {
    if (serial.state !== 'SOLD' || !this.canViewSerial) {
      return;
    }

    this.ask('return', serial, {});
  }

  /**
   * Reingresar al stock una unidad devuelta. Acá el saldo **sí** se mueve, así que la confirmación
   * dice a qué depósito vuelve —la fila lo tiene: la devuelta físicamente está—.
   */
  protected onReinstate(serial: ProductSerialDto): void {
    if (serial.state !== 'RETURNED' || !this.canReinstate) {
      return;
    }

    this.ask('reinstate', serial, { warehouse: serial.warehouse?.name ?? '' });
  }

  private ask(
    action: SerialAction,
    serial: ProductSerialDto,
    params: Record<string, string>,
  ): void {
    const key = `stock.serial.${action}Confirm`;
    this.confirm
      .confirm({
        title: this.translate.instant(`${key}.title`),
        message: `${this.translate.instant(`${key}.message`, {
          serial: serial.serialNumber,
          ...params,
        })} ${this.translate.instant(`${key}.hint`)}`,
        confirmLabel: this.translate.instant(`${key}.confirm`),
        cancelLabel: this.translate.instant(`${key}.cancel`),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.run(action, serial);
        }
      });
  }

  private run(action: SerialAction, serial: ProductSerialDto): void {
    const payload = { serialNumber: serial.serialNumber };
    const request =
      action === 'return'
        ? this.serialsApi.registerReturn(payload)
        : this.serialsApi.reinstate(payload);

    this.pending.set(serial.serialNumber);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.pending.set(null);
        this.toast.success(
          this.translate.instant(`stock.serial.${action}Done`, { serial: serial.serialNumber }),
        );
        // La devolución sólo cambia la unidad; el reingreso además sube el saldo. Se avisa en los
        // dos casos: es lo que mantiene el cartel de consistencia diciendo la verdad.
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.pending.set(null);
        this.toast.error(
          resolveApiErrorMessage(error, this.translate.instant(`stock.serial.${action}Error`)),
        );
      },
    });
  }
}
