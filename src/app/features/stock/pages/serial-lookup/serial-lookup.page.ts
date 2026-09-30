import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { API_ERROR_CODES, hasApiErrorCode, resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { SerialLookupDto } from '../../../../core/stock/stock-serial.model';
import { StockSerialsApiService } from '../../../../core/stock/stock-serials-api.service';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { SALES_PATH } from '../../../sales/sales.paths';
import { EXPIRATIONS_PATH } from '../../stock.paths';

/**
 * Consulta por número de serie (§13.7, wireframe `1q`): con la unidad en la mano, a quién se le
 * vendió, cuándo y con qué comprobante.
 *
 * **Es una línea de tiempo y no una tabla.** La unidad tiene a lo sumo una entrada y una salida, así
 * que la consulta tiene una sola respuesta y se lee de arriba abajo. El dato de contacto del cliente
 * está a la vista porque es lo que se necesita para atender la garantía — que es a lo único que se
 * viene a esta pantalla.
 *
 * La pantalla arranca **vacía**: sin número no hay nada que mostrar, y un estado vacío que dice qué
 * hacer es mejor que una tabla de todas las series de la empresa que nadie pidió.
 */
@Component({
  selector: 'app-serial-lookup-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    LocalizedDatePipe,
    LoadStateComponent,
  ],
  templateUrl: './serial-lookup.page.html',
  styleUrl: './serial-lookup.page.css',
})
export class SerialLookupPage implements OnInit {
  private readonly api = inject(StockSerialsApiService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Lo que hay escrito en el buscador. Se separa del número consultado a propósito. */
  protected readonly query = signal(this.route.snapshot.paramMap.get('serialNumber') ?? '');
  /** El número de la última consulta hecha: es el que nombran el error y el mensaje de vacío. */
  protected readonly searched = signal('');

  protected readonly loadState = signal(LoadState.Success);
  protected readonly serial = signal<SerialLookupDto | null>(null);
  protected readonly notFound = signal(false);
  /** Una acción de postventa en vuelo (devolución o reingreso): apaga los dos botones. */
  protected readonly returning = signal(false);

  protected readonly LoadState = LoadState;

  /**
   * Sólo se devuelve lo vendido. El botón no aparece en una unidad que sigue en stock: no volvió de
   * ningún lado.
   */
  protected readonly canRegisterReturn = computed(() => this.serial()?.state === 'SOLD');

  /**
   * El reingreso **mueve el saldo**, así que además del permiso de postventa pide el de ajuste. Se
   * consulta acá y no sólo en el backend para no ofrecer un botón que va a responder 403: quien no
   * puede mover inventario no tiene por qué ver la acción.
   */
  private readonly canAdjustStock = this.auth.hasPermission(Permissions.stockAdjustment);

  protected readonly canReinstate = computed(
    () => this.serial()?.state === 'RETURNED' && this.canAdjustStock,
  );

  /**
   * La unidad que volvió y ya se reingresó: está `IN_STOCK` **y** tiene una salida registrada. Sin
   * distinguirlo, la línea de tiempo diría «se vendió» y después «sigue en el depósito», que leído
   * seguido se contradice.
   */
  protected readonly wasReinstated = computed(() => {
    const unit = this.serial();
    return unit?.state === 'IN_STOCK' && !!unit.exit;
  });

  /** Qué decir en el último punto de la línea de tiempo, según dónde quedó la unidad. */
  protected readonly pendingKey = computed(() => {
    if (this.wasReinstated()) {
      return 'stock.serial.timeline.pendingReinstated';
    }
    const state = this.serial()?.state;
    return state ? `stock.serial.timeline.pending${this.capitalize(state)}` : null;
  });

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stock', link: EXPIRATIONS_PATH },
      { labelKey: 'stock.serial.title' },
    ]);
  }

  ngOnInit(): void {
    if (this.query().trim()) {
      this.search();
    }
  }

  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * `(submit)` con `preventDefault` y no `(ngSubmit)`, que es la convención del proyecto para los
   * formularios sin `ngModel`: sin `FormsModule` importado la directiva `NgForm` no existe, así que
   * `ngSubmit` nunca se dispara y el navegador hace el submit nativo — la página se recargaba con
   * el número en el query string y la consulta no llegaba a correr.
   */
  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.search();
  }

  /**
   * Buscar. El lector de código de barras termina con Enter, así que el submit del formulario es el
   * camino rápido y el botón está para quien tipea.
   */
  protected search(): void {
    const serialNumber = this.query().trim();
    if (!serialNumber) {
      return;
    }

    this.searched.set(serialNumber);
    this.notFound.set(false);
    this.loadState.set(LoadState.Loading);
    this.api
      .lookup(serialNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (serial) => {
          this.serial.set(serial);
          this.loadState.set(LoadState.Success);
        },
        error: (error: unknown) => {
          this.serial.set(null);
          // Que la serie no exista no es una falla de la consulta: es una respuesta, y una útil
          // —«esa unidad no es nuestra»— cuando alguien trae a garantía algo comprado en otro lado.
          if (hasApiErrorCode(error, API_ERROR_CODES.SERIAL_NOT_FOUND)) {
            this.notFound.set(true);
            this.loadState.set(LoadState.Success);
            return;
          }
          this.loadState.set(LoadState.Error);
        },
      });
  }

  /**
   * Abrir la operación. El listado de ventas no tiene detalle por uuid —una venta es un commit
   * atómico y no hay nada que editar—, así que se llega por su **número**, que es el filtro que la
   * pantalla ya tiene y el dato que el mostrador está mirando.
   */
  protected onOpenOrder(publicId: string | null | undefined): void {
    if (!publicId) {
      return;
    }
    void this.router.navigate([SALES_PATH], { queryParams: { q: publicId } });
  }

  /**
   * Registrar la devolución. Se confirma porque cambia el estado de la unidad y porque **no** hace
   * lo que parece: no la devuelve al stock vendible, la aparta.
   */
  protected onRegisterReturn(): void {
    const serial = this.serial();
    if (!serial || !this.canRegisterReturn()) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('stock.serial.returnConfirm.title'),
        message: `${this.translate.instant('stock.serial.returnConfirm.message', {
          serial: serial.serialNumber,
        })} ${this.translate.instant('stock.serial.returnConfirm.hint')}`,
        confirmLabel: this.translate.instant('stock.serial.returnConfirm.confirm'),
        cancelLabel: this.translate.instant('stock.serial.returnConfirm.cancel'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.registerReturn(serial.serialNumber);
        }
      });
  }

  /**
   * Reingresar al stock. Se confirma como la devolución, y por el motivo opuesto: acá el saldo
   * **sí** se mueve, y el mensaje dice a qué depósito vuelve la unidad para que no sea a ciegas.
   */
  protected onReinstate(): void {
    const serial = this.serial();
    if (!serial || !this.canReinstate()) {
      return;
    }

    this.confirm
      .confirm({
        title: this.translate.instant('stock.serial.reinstateConfirm.title'),
        message: `${this.translate.instant('stock.serial.reinstateConfirm.message', {
          serial: serial.serialNumber,
          warehouse: serial.entry?.warehouse?.name ?? '',
        })} ${this.translate.instant('stock.serial.reinstateConfirm.hint')}`,
        confirmLabel: this.translate.instant('stock.serial.reinstateConfirm.confirm'),
        cancelLabel: this.translate.instant('stock.serial.reinstateConfirm.cancel'),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.reinstate(serial.serialNumber);
        }
      });
  }

  private reinstate(serialNumber: string): void {
    this.returning.set(true);
    this.api
      .reinstate({ serialNumber })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (serial) => {
          this.returning.set(false);
          this.serial.set(serial);
          this.toast.success(
            this.translate.instant('stock.serial.reinstateDone', { serial: serialNumber }),
          );
        },
        error: (error: unknown) => {
          this.returning.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stock.serial.reinstateError')),
          );
        },
      });
  }

  private registerReturn(serialNumber: string): void {
    this.returning.set(true);
    this.api
      .registerReturn({ serialNumber })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (serial) => {
          this.returning.set(false);
          this.serial.set(serial);
          this.toast.success(
            this.translate.instant('stock.serial.returnDone', { serial: serialNumber }),
          );
        },
        error: (error: unknown) => {
          this.returning.set(false);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('stock.serial.returnError')),
          );
        },
      });
  }

  /** `IN_STOCK` → `InStock`: el sufijo con el que se arma la clave de traducción del último punto. */
  private capitalize(value: string): string {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  }
}
