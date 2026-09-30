import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorBody,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PackagingRef } from '../../../../core/product/product-lookup.model';
import { ProductPackagingsApiService } from '../../../../core/product/product-packagings-api.service';
import { PickerProduct } from '../../../../core/product-picker/product-picker.model';
import { ProductPickerService } from '../../../../core/product-picker/product-picker.service';
import { WarehouseDto } from '../../../../core/warehouse/warehouse.model';
import { WarehousesApiService } from '../../../../core/warehouse/warehouses-api.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  ForceTransferDialogComponent,
  ForceTransferDialogData,
  ForceTransferShortage,
} from '../../components/force-transfer-dialog/force-transfer-dialog.component';
import {
  SerialPickerDialogComponent,
  SerialPickerDialogData,
  SerialPickerDialogResult,
} from '../../../../core/stock/serial-picker-dialog/serial-picker-dialog.component';
import {
  LotAllocationDialogComponent,
  LotAllocationDialogData,
  LotAllocationDialogResult,
} from '../../components/lot-allocation-dialog/lot-allocation-dialog.component';
import {
  StockTransferDispatchPayload,
  TRANSFER_DISPATCH_PERMISSION,
  TransferMode,
} from '../../data-access/stock-transfer.model';
import { StockTransfersApiService } from '../../data-access/stock-transfers-api.service';
import {
  STOCK_TRANSFERS_PATH,
  stockTransferDetailPath,
} from '../../stock-transfers.paths';
import { TransferDraft, TransferDraftLineView } from '../../state/transfer-draft';

/**
 * El despacho de un traslado: de qué depósito sale, a cuál entra, con qué modalidad y qué se mueve.
 *
 * Sólo hay alta. Un traslado no se edita por ningún camino: despacharlo **descuenta stock del
 * origen en el acto**, y editar una operación que ya movió inventario sería reescribir el saldo de
 * dos depósitos hacia atrás. Lo que se corrige es con otro traslado en sentido contrario.
 *
 * Dos cosas que la pantalla deliberadamente **no** decide:
 *
 * - **Si el faltante bloquea.** Lo decide la política de stock de la sucursal, y el `412` del
 *   backend es lo que abre el diálogo de confirmación. La pantalla avisa del faltante mientras se
 *   arma —para que no sea una sorpresa— pero no bloquea el botón por eso.
 * - **De qué lote sale cada línea.** Por defecto lo resuelve la política de asignación; el diálogo
 *   de lotes existe para las veces en que el operador necesita mandar una partida concreta.
 */
@Component({
  selector: 'app-stock-transfer-form-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
  ],
  providers: [StockTransfersApiService, WarehousesApiService, ProductPackagingsApiService],
  templateUrl: './stock-transfer-form.page.html',
  styleUrl: './stock-transfer-form.page.css',
})
export class StockTransferFormPage implements OnInit {
  private readonly api = inject(StockTransfersApiService);
  private readonly packagingsApi = inject(ProductPackagingsApiService);
  private readonly warehousesApi = inject(WarehousesApiService);
  private readonly productPicker = inject(ProductPickerService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly draft = new TransferDraft();

  protected readonly canDispatch = this.auth.hasPermission(TRANSFER_DISPATCH_PERMISSION);
  protected readonly activeBranch = this.auth.selectedBranch;

  /** Depósitos de la sucursal activa: el origen sale siempre de acá. */
  protected readonly sourceWarehouses = signal<readonly WarehouseDto[]>([]);
  /**
   * Depósitos de toda la empresa, para el destino. Leerlos exige `stock.view_all_branches`; sin él
   * la pantalla se queda con los de la sucursal activa y el traslado sólo puede ser interno, que es
   * exactamente lo que ese permiso significa.
   */
  protected readonly allWarehouses = signal<readonly WarehouseDto[]>([]);
  protected readonly crossBranchAvailable = signal(true);

  protected readonly dispatching = signal(false);

  /** El texto tipeado en el buscador de productos; lo hereda el selector avanzado al abrirse. */
  protected readonly productQuery = signal('');

  /**
   * Sucursales que pueden ser destino.
   *
   * Sin `stock.view_all_branches` el destino no sale de la sucursal activa, así que la única
   * opción es ella: no se filtra por «tiene depósitos visibles» porque el paginado acotado a la
   * sucursal puede no traer el `branch` de cada depósito, y ese filtro dejaría el select vacío
   * —inutilizando también el traslado interno, que sí está permitido—.
   *
   * Con el permiso sí se filtra: una sucursal sin depósitos no es un destino posible, y ofrecerla
   * lleva a un segundo select vacío.
   */
  protected readonly targetBranches = computed<readonly BranchDto[]>(() => {
    const active = this.auth.selectedBranch();
    if (!this.crossBranchAvailable()) {
      return active ? [active] : [];
    }

    const withWarehouses = new Set(
      this.allWarehouses()
        .map((warehouse) => warehouse.branch?.uuid)
        .filter((uuid): uuid is string => uuid !== undefined && uuid !== null),
    );

    // `availableBranches` es una señal: se lee acá y no en `ngOnInit` para que el select se pueble
    // solo si las sucursales terminan de cargar después de que la pantalla se dibujó.
    return (this.auth.availableBranches() ?? []).filter((branch) =>
      withWarehouses.has(branch.uuid),
    );
  });

  /** Depósitos de la sucursal de destino elegida, menos el de origen: nadie se traslada a sí mismo. */
  protected readonly targetWarehouses = computed(() => {
    const branchUuid = this.draft.targetBranchUuid();
    const sourceUuid = this.draft.sourceWarehouse()?.uuid;
    const notSource = (warehouse: WarehouseDto): boolean => warehouse.uuid !== sourceUuid;

    // Mismo motivo que arriba: sin el permiso, los depósitos son los de la sucursal activa y no
    // hace falta —ni se puede— compararlos contra su `branch`.
    if (!this.crossBranchAvailable()) {
      return this.sourceWarehouses().filter(notSource);
    }

    return this.allWarehouses().filter(
      (warehouse) => warehouse.branch?.uuid === branchUuid && notSource(warehouse),
    );
  });

  protected readonly lineViews = this.draft.lineViews;
  protected readonly shortages = this.draft.linesWithShortage;

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stockTransfers', link: STOCK_TRANSFERS_PATH },
      { labelKey: 'stockTransfers.form.title' },
    ]);
  }

  ngOnInit(): void {
    this.draft.setTargetBranch(this.auth.selectedBranchUuid());
    this.loadWarehouses();
  }

  protected onBack(): void {
    void this.router.navigate([STOCK_TRANSFERS_PATH]);
  }

  protected onSourceWarehouseChange(uuid: string): void {
    const warehouse = this.sourceWarehouses().find((item) => item.uuid === uuid) ?? null;
    this.draft.setSourceWarehouse(warehouse);

    // El destino puede haber quedado apuntando al mismo depósito que ahora es el origen.
    if (this.draft.targetWarehouse()?.uuid === uuid) {
      this.draft.setTargetWarehouse(null);
    }

    this.refreshStockAtSource();
  }

  protected onTargetBranchChange(uuid: string): void {
    this.draft.setTargetBranch(uuid);
  }

  protected onTargetWarehouseChange(uuid: string): void {
    this.draft.setTargetWarehouse(
      this.allWarehouses().find((item) => item.uuid === uuid) ?? null,
    );
  }

  protected onModeChange(mode: TransferMode): void {
    this.draft.setMode(mode);
  }

  /**
   * Abre el selector de productos con lo que ya se venía tipeando. Se elige del catálogo completo
   * (`any`): un producto se traslada aunque no esté habilitado para vender ni para comprar — un
   * insumo, un envase — porque trasladarlo es sólo moverlo de lugar.
   *
   * Lo único que se acota es el eje (`trackedOnly`): un servicio o un kit virtual no tienen
   * existencias que mover (RN-06, RN-07), y ofrecerlos termina en un `400` recién al despachar,
   * después de que el operador les cargó cantidad y abrió el diálogo de lotes vacío.
   */
  protected onAddProduct(): void {
    this.productPicker
      .pick({
        availability: 'any',
        trackedOnly: true,
        initialSearch: this.productQuery(),
        title: this.translate.instant('stockTransfers.form.pickerTitle'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((product) => {
        if (!product) {
          return;
        }

        this.productQuery.set('');
        this.draft.addProduct(product);
        this.loadStockFor(product);
        this.loadPackagingsFor(product);
      });
  }

  protected onQuantityChange(productUuid: string, raw: number | string): void {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value) && value > 0) {
      this.draft.setQuantity(productUuid, value);
    }
  }

  /**
   * El empaque de la línea que corresponde al uuid elegido, o `null` para la unidad base.
   *
   * Traduce del `uuid` que devuelve el `mat-select` al objeto que la conversión necesita: el select
   * no puede llevar el empaque entero como valor porque compara por identidad, y la lista se
   * reconstruye en cada lectura.
   */
  protected packagingOf(line: TransferDraftLineView, uuid: string | null): PackagingRef | null {
    return line.packagings.find((option) => option.uuid === uuid) ?? null;
  }

  /** Cambiar de unidad no cambia lo que se mueve: la cantidad sigue siendo la misma en unidad base. */
  protected onPackagingChange(productUuid: string, packaging: PackagingRef | null): void {
    this.draft.setPackaging(productUuid, packaging);
  }

  /** La cantidad escrita cuando la línea se está cargando en empaques, no en unidad base. */
  protected onPackageQuantityChange(productUuid: string, raw: number | string): void {
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value) && value > 0) {
      this.draft.setPackageQuantity(productUuid, value);
    }
  }

  protected onStepQuantity(line: TransferDraftLineView, delta: number): void {
    this.draft.setQuantity(line.product.uuid, Math.max(0, line.quantity + delta));
  }

  protected onRemove(productUuid: string): void {
    this.draft.removeProduct(productUuid);
  }

  /**
   * Elegir a mano de qué lotes sale la línea. Sin depósito de origen no hay lotes que ofrecer, así
   * que el botón sólo aparece cuando ya está elegido.
   */
  protected onEditLots(line: TransferDraftLineView): void {
    const warehouse = this.draft.sourceWarehouse();
    if (!warehouse) {
      return;
    }

    const data: LotAllocationDialogData = {
      product: line.product,
      sourceWarehouseUuid: warehouse.uuid,
      sourceWarehouseName: warehouse.name,
      quantity: line.quantity,
      current: line.lots,
    };

    this.dialog
      .open<LotAllocationDialogComponent, LotAllocationDialogData, LotAllocationDialogResult>(
        LotAllocationDialogComponent,
        { width: '40rem', maxWidth: '95vw', maxHeight: '90vh', data },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lots) => {
        if (lots) {
          this.draft.setLots(line.product.uuid, lots);
        }
      });
  }

  /** Devuelve la línea al reparto automático, que es lo que hace la política de la sucursal. */
  protected onClearLots(productUuid: string): void {
    this.draft.setLots(productUuid, []);
  }

  /**
   * Elegir **qué unidades** se van, en una línea de producto serializado.
   *
   * Es el mismo diálogo que usa la venta, acotado al depósito de origen: la venta puede sacar de
   * cualquier depósito de la sucursal —lo decide la política— y el traslado despacha de uno solo,
   * así que ofrecer una unidad de otro terminaría en el `SERIAL_NOT_AVAILABLE` del commit.
   *
   * A diferencia del lote, esto **no es opcional y no pide permiso**: no es salirse de una política,
   * es decir qué notebook se manda (§9). La cantidad de la línea la fija lo que se elija.
   */
  protected onPickSerials(line: TransferDraftLineView): void {
    const warehouse = this.draft.sourceWarehouse();
    if (!warehouse) {
      return;
    }

    const data: SerialPickerDialogData = {
      product: { uuid: line.product.uuid, name: line.product.name },
      // Con la línea todavía sin unidades no hay un objetivo que alcanzar, así que el diálogo pide
      // «al menos una»: el operador elige cuántas se van y la línea se entera después.
      quantity: line.serials.length > 0 ? line.serials.length : 1,
      current: line.serials,
      warehouse: { uuid: warehouse.uuid, name: warehouse.name },
      lead: this.translate.instant('stock.serialPicker.leadTransfer'),
    };

    this.dialog
      .open<SerialPickerDialogComponent, SerialPickerDialogData, SerialPickerDialogResult>(
        SerialPickerDialogComponent,
        { width: '32rem', maxWidth: '95vw', autoFocus: 'first-heading', data },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((serials) => {
        if (serials) {
          this.draft.setSerials(line.product.uuid, serials);
        }
      });
  }

  protected onDispatch(): void {
    if (!this.draft.isReadyToDispatch() || this.dispatching()) {
      return;
    }

    this.dispatch(false);
  }

  /**
   * Despacha. Un `412` no es un error: es la política de la sucursal preguntando si se confirma
   * dejar el depósito en negativo, y se contesta reenviando el mismo payload con `forceTransfer`.
   */
  private dispatch(force: boolean): void {
    const payload = this.buildPayload(force);
    if (!payload) {
      return;
    }

    this.dispatching.set(true);

    this.api
      .dispatch(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transfer) => {
          this.dispatching.set(false);
          this.toast.success(
            this.translate.instant('stockTransfers.form.dispatched', {
              transfer: transfer.publicId ?? '',
            }),
          );
          this.draft.clear();
          void this.router.navigate([stockTransferDetailPath(transfer.uuid)]);
        },
        error: (error: unknown) => {
          this.dispatching.set(false);

          if (!force && hasApiErrorCode(error, API_ERROR_CODES.STOCK_CONFIRMATION_REQUIRED)) {
            this.askToForce(error);
            return;
          }

          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stockTransfers.form.dispatchError')),
          );
        },
      });
  }

  /** El diálogo que abre el `412`. Aceptar reenvía el mismo traslado con `forceTransfer: true`. */
  private askToForce(error: unknown): void {
    const warehouse = this.draft.sourceWarehouse();
    const data: ForceTransferDialogData = {
      sourceWarehouseName: warehouse?.name ?? '',
      branchName: this.activeBranch()?.name ?? '',
      shortages: this.shortages().map(toShortage),
      apiMessage: readApiErrorBody(error)?.userMessage ?? null,
    };

    this.dialog
      .open<ForceTransferDialogComponent, ForceTransferDialogData, boolean>(
        ForceTransferDialogComponent,
        { width: '32rem', maxWidth: '95vw', data },
      )
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.dispatch(true);
        }
      });
  }

  private buildPayload(force: boolean): StockTransferDispatchPayload | null {
    const from = this.draft.sourceWarehouse();
    const to = this.draft.targetWarehouse();
    if (!from || !to) {
      return null;
    }

    return {
      fromWarehouse: { uuid: from.uuid },
      toWarehouse: { uuid: to.uuid },
      transferMode: this.draft.mode(),
      items: this.draft.toItems(),
      ...(force ? { forceTransfer: true } : {}),
    };
  }

  /**
   * Los depósitos. El origen sale de la sucursal activa; el destino, de toda la empresa cuando el
   * permiso lo habilita. Que el segundo falle no rompe la pantalla: se cae al traslado interno, que
   * es lo que el permiso ausente significa.
   */
  private loadWarehouses(): void {
    this.warehousesApi
      .listAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (warehouses) => {
          this.sourceWarehouses.set(warehouses);
          this.preselectSource(warehouses);
        },
        error: () =>
          this.toast.error(this.translate.instant('stockTransfers.form.warehousesError')),
      });

    this.warehousesApi
      .listAll(true)
      .pipe(
        catchError(() => {
          this.crossBranchAvailable.set(false);
          return of([] as WarehouseDto[]);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((warehouses) => {
        // Con el permiso, éstos son los depósitos de toda la empresa. Sin él la lista queda vacía
        // y `crossBranchAvailable` ya está en false: el destino lo resuelven los depósitos de la
        // sucursal activa, que es lo único que ese usuario puede ver.
        this.allWarehouses.set(warehouses);
      });
  }

  /**
   * El primer depósito de la cola de descuento queda elegido de entrada: es el que la política de
   * la sucursal vaciaría primero, así que es el origen por defecto de cualquier traslado.
   */
  private preselectSource(warehouses: readonly WarehouseDto[]): void {
    if (!this.draft.sourceWarehouse() && warehouses.length > 0) {
      this.draft.setSourceWarehouse(warehouses[0]);
    }
  }

  /**
   * Los empaques del producto recién agregado (RN-16).
   *
   * Es una lectura aparte y no un dato del selector porque `ProductPaginateDTO` no los trae. Que
   * falle no rompe la línea: se queda cargando en unidad base, que es lo que hacía antes de que
   * esto existiera.
   */
  private loadPackagingsFor(product: PickerProduct): void {
    this.packagingsApi
      .getPackagings(product.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (packagings) => this.draft.setPackagings(product.uuid, packagings),
        error: () => undefined,
      });
  }

  /** Relee el saldo de todas las líneas: cambiar el depósito de origen cambia todos los saldos. */
  private refreshStockAtSource(): void {
    for (const line of this.draft.lines()) {
      this.loadStockFor(line.product);
    }
  }

  /**
   * Cuánto tiene el producto **en el depósito de origen**, sumando los lotes con saldo.
   *
   * Sale de los mismos lotes que ofrece el reparto manual y no de la distribución por depósito
   * porque es exactamente el conjunto contra el que el traslado va a descontar: si un lote no
   * aparece acá, tampoco lo va a consumir el despacho.
   *
   * El `totalStock` que trae el selector no sirve para esto: es el de la sucursal entera, y lo que
   * acota un traslado es el depósito — un producto con 200 en la sucursal puede tener 6 en el
   * depósito del que sale.
   *
   * Los lotes `blocked` **no se suman**: son los que la política de vencidos de la sucursal no deja
   * despachar, y el backend valida el faltante contra el saldo sin ellos (RN-04). Contarlos acá
   * mostraría un disponible que alcanza y dejaría que el `412` sea la primera noticia.
   */
  private loadStockFor(product: PickerProduct): void {
    const warehouse = this.draft.sourceWarehouse();
    if (!warehouse) {
      return;
    }

    this.api
      .sourceBatches(warehouse.uuid, product.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batches) =>
          this.draft.setStockAtSource(
            product.uuid,
            batches
              .filter((batch) => !batch.blocked)
              .reduce((total, batch) => total + (batch.availableQuantity ?? 0), 0),
          ),
        // Sin saldo leído la línea no muestra faltante; el backend lo valida igual al despachar.
        error: () => undefined,
      });
  }
}

function toShortage(line: TransferDraftLineView): ForceTransferShortage {
  return {
    productName: line.product.name,
    available: line.availableAtSource ?? 0,
    requested: line.quantity,
  };
}
