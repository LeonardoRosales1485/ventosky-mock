import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  CheckingAccountAllocationRowDto,
  CheckingAccountCreditRowDto,
  CheckingAccountDebtRowDto,
  DebtExtensionRowDto,
  PartyRole,
} from '../../data-access/checking-account.model';
import { PURCHASES_PATH } from '../../../purchases/purchases.paths';
import { SALES_PATH } from '../../../sales/sales.paths';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

/**
 * De qué partida es la línea de tiempo. Una de las dos, nunca las dos: desde la deuda se lee «cómo
 * llegó a su pendiente» y desde el cobro «a qué deudas se aplicó», que son la misma cadena leída en
 * direcciones opuestas.
 */
export interface DebtTimelineDialogData {
  debt?: CheckingAccountDebtRowDto;
  credit?: CheckingAccountCreditRowDto;
  /**
   * Qué es el titular de la cuenta, para saber a qué pantalla vuelve la deuda.
   *
   * La misma orden es una **venta** en la cuenta de un cliente y una **compra** en la de un
   * proveedor: la deuda no lo sabe —`origin: ORDER` no distingue— y la cuenta sí. Sin esto el enlace
   * tendría que adivinar, y adivinaría mal justo en las cuentas de proveedor.
   */
  partyRole?: PartyRole;
}

/** Qué pidió el usuario sobre una de las filas, para que la pantalla abra el diálogo que toca. */
export interface DebtTimelineDialogResult {
  action: 'reverse' | 'reassign' | 'trace';
  allocation: CheckingAccountAllocationRowDto;
  /** Lo que le queda vigente a esa imputación, ya descontadas sus reversiones. */
  activeAmount: number;
}

/**
 * Cómo llegó una deuda a su pendiente: sus imputaciones y las reversiones que las deshicieron.
 *
 * **Se muestra como línea de tiempo y no como árbol.** El árbol es la estructura —una reversión
 * apunta a lo que deshace, y una reimputación a la reversión que la financió—, pero la pregunta que
 * alguien trae acá es «qué pasó con esta deuda», y eso se contesta en orden cronológico. Cada salto
 * de la cadena va hacia adelante en el tiempo, así que el orden por fecha ya es el recorrido.
 *
 * Es también el punto desde donde se desimputa y se reimputa: son operaciones sobre **una
 * imputación**, y éste es el único lugar donde las imputaciones se ven de a una.
 */
@Component({
  selector: 'app-debt-timeline-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    RouterLink,
  ],
  templateUrl: './debt-timeline-dialog.component.html',
  styleUrl: './debt-timeline-dialog.component.css',
})
export class DebtTimelineDialogComponent implements OnInit {
  private readonly dialogRef =
    inject<MatDialogRef<DebtTimelineDialogComponent, DebtTimelineDialogResult>>(MatDialogRef);
  private readonly api = inject(CheckingAccountsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<DebtTimelineDialogData>(MAT_DIALOG_DATA);

  protected readonly entries = signal<readonly CheckingAccountAllocationRowDto[]>([]);
  protected readonly loading = signal(true);

  /** Las prórrogas de esta deuda, de la más nueva a la más vieja. Vacío si no se prorrogó nunca. */
  protected readonly extensions = signal<readonly DebtExtensionRowDto[]>([]);

  /**
   * Que la consulta de prórrogas falle **no rompe el diálogo**: es contexto, no la respuesta. La
   * pregunta que trae a alguien acá es qué pasó con la plata, y eso lo contesta la línea de tiempo.
   */
  protected readonly extensionsFailed = signal(false);

  /** Desde el cobro la fila interesante es la deuda, y al revés. */
  protected readonly fromCredit = !!this.data.credit;

  ngOnInit(): void {
    const load = this.data.credit
      ? this.api.paginateCreditAllocations(this.data.credit.uuid, { page: 1, size: 100 })
      : this.api.paginateDebtTimeline(this.data.debt!.uuid, { page: 1, size: 100 });

    load
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.entries.set(page.content ?? []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });

    this.loadExtensions();
  }

  private loadExtensions(): void {
    const debt = this.data.debt;
    if (!debt) {
      return;
    }
    this.api
      .paginateDebtExtensions(debt.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.extensions.set(page.content ?? []),
        error: () => this.extensionsFailed.set(true),
      });
  }

  /**
   * A qué pantalla vuelve la deuda, y con qué búsqueda.
   *
   * **No hay pantalla de detalle de una orden**: ventas tiene sólo su listado y compras el listado
   * más la edición de un borrador. Así que el enlace abre el listado que corresponde ya filtrado por
   * el número de comprobante —los dos buscan por `public_id`—, que es lo más cerca de «llevame a esa
   * orden» que el sistema permite hoy sin inventar una pantalla.
   *
   * Cliente ⇒ venta, proveedor ⇒ compra: es la misma orden leída desde cada lado del mostrador.
   */
  protected orderLink(): { path: string; query: Record<string, string> } | null {
    const order = this.data.debt?.order;
    if (!order?.name) {
      return null;
    }
    const path = this.data.partyRole === 'SUPPLIER' ? PURCHASES_PATH : SALES_PATH;
    return { path, query: { q: order.name } };
  }

  /**
   * Lo que le queda vigente a una imputación: su importe menos lo ya revertido.
   *
   * Se calcula sobre las filas que ya están en pantalla —todas las de esta deuda— y no con otra
   * consulta: las reversiones apuntan a lo que deshacen por `reversesUuid`, así que la resta es un
   * filtro sobre la misma lista. El backend la vuelve a hacer y es él quien decide.
   */
  protected activeAmountOf(allocation: CheckingAccountAllocationRowDto): number {
    const reversed = this.entries()
      .filter((entry) => entry.reversesUuid === allocation.uuid)
      .reduce((total, entry) => total + entry.amount, 0);
    return round(allocation.amount - reversed);
  }

  /** Sólo una imputación con saldo vigente se puede deshacer o mover. */
  protected canOperate(allocation: CheckingAccountAllocationRowDto): boolean {
    return allocation.entryType === 'ALLOCATION' && this.activeAmountOf(allocation) > 0;
  }

  protected onReverse(allocation: CheckingAccountAllocationRowDto): void {
    this.dialogRef.close({
      action: 'reverse',
      allocation,
      activeAmount: this.activeAmountOf(allocation),
    });
  }

  protected onReassign(allocation: CheckingAccountAllocationRowDto): void {
    this.dialogRef.close({
      action: 'reassign',
      allocation,
      activeAmount: this.activeAmountOf(allocation),
    });
  }

  /**
   * A dónde fue esa plata.
   *
   * Se ofrece sobre cualquier imputación, con o sin saldo vigente: justamente en la que ya no queda
   * nada es donde la pregunta tiene sentido, porque la respuesta es a dónde se fue.
   */
  protected onTrace(allocation: CheckingAccountAllocationRowDto): void {
    this.dialogRef.close({
      action: 'trace',
      allocation,
      activeAmount: this.activeAmountOf(allocation),
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
