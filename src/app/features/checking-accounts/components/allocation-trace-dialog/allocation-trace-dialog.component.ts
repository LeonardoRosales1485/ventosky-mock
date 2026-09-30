import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  AllocationTraceDto,
  CheckingAccountAllocationRowDto,
  CheckingAccountCreditRowDto,
  CheckingAccountDebtRowDto,
} from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

export interface AllocationTraceDialogData {
  allocation: CheckingAccountAllocationRowDto;
  /**
   * La deuda de destino, cuando quien abre el diálogo la tiene en la mano —la línea de tiempo de la
   * ficha—. Con ella la tarjeta de la deuda cierra de verdad: arranca en el importe emitido y
   * termina en el pendiente de hoy. Sin ella se muestran los movimientos y nada más: **no hay
   * endpoint para leer una deuda suelta**, y estimar el importe original sumando filas sería
   * inventar el número que la tarjeta existe para verificar.
   */
  debt?: CheckingAccountDebtRowDto;
}

/** Una imputación del mismo cobro, con lo que le queda en pie. */
interface SiblingAllocation {
  entry: CheckingAccountAllocationRowDto;
  /** `amount − Σ` de sus reversiones: lo que esta porción todavía sostiene. */
  activeAmount: number;
  /** Si es la que el diálogo está mostrando. */
  current: boolean;
}

/**
 * A dónde fue esa plata: la trazabilidad de **una** imputación.
 *
 * **Se dibuja por nivel y no como árbol.** El árbol es la estructura —una reversión apunta a lo que
 * deshace, una reimputación a la reversión que la financió—, pero cada salto va siempre hacia
 * adelante en el tiempo, así que el `depth` que devuelve la consulta recursiva **ya es la línea de
 * tiempo**. Dibujarlo como árbol obligaría a leer dos veces lo mismo.
 *
 * **Dos imputaciones del mismo cobro nunca se encadenan.** Ninguna deshace a la otra ni salió de la
 * otra: son dos porciones independientes de la misma plata. Por eso el recorrido de una termina en
 * el nivel 0 aunque la otra siga viva, y por eso hace falta el bloque **«qué hizo todo este cobro»**
 * —las porciones hermanas, con su deuda de destino—: sin él, parado en $5.000 de un cobro de
 * $10.000 nada dice que exista la otra mitad ni dónde terminó. Es la quinta pregunta de §8.4, y se
 * contesta con un filtro plano por crédito, sin recursión.
 *
 * **Desde una porción se salta a otra**: clickear una hermana reabre la traza sobre ella, que es lo
 * que hace que el seguimiento de un cobro repartido sea recorrible y no una sucesión de diálogos.
 *
 * **La causa se muestra con palabras y no con el código.** Manual, reimputada, anulación del cobro y
 * anulación de la deuda son cuatro respuestas distintas a «por qué volvió a la bandeja», y
 * `CREDIT_VOID` no es ninguna de las cuatro para quien lee.
 *
 * **Reversiones en rojo, imputaciones en azul, con sangría por nivel**: la forma cuenta la historia
 * antes de que alguien lea los importes.
 */
@Component({
  selector: 'app-allocation-trace-dialog',
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
  ],
  templateUrl: './allocation-trace-dialog.component.html',
  styleUrl: './allocation-trace-dialog.component.css',
})
export class AllocationTraceDialogComponent implements OnInit {
  private readonly api = inject(CheckingAccountsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<AllocationTraceDialogData>(MAT_DIALOG_DATA);

  /** Sobre qué imputación se está mirando la traza. Cambia al saltar a una hermana. */
  private readonly currentUuid = signal(this.data.allocation.uuid);

  protected readonly trace = signal<AllocationTraceDto | null>(null);
  protected readonly credit = signal<CheckingAccountCreditRowDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  /**
   * Las porciones del mismo cobro, con lo que le queda en pie a cada una.
   *
   * Lo vigente se deriva de las mismas filas y no se pide aparte: las reversiones del cobro apuntan
   * a la imputación que deshacen por `reversesUuid`, así que restarlas es leer lo que ya está.
   */
  protected readonly siblings = computed<readonly SiblingAllocation[]>(() => {
    const rows = this.credit()?.allocations ?? [];
    const current = this.currentUuid();

    return rows
      .filter((entry) => entry.entryType === 'ALLOCATION')
      .map((entry) => ({
        entry,
        activeAmount: round(
          entry.amount -
            rows
              .filter((row) => row.entryType === 'REVERSAL' && row.reversesUuid === entry.uuid)
              .reduce((total, row) => total + row.amount, 0),
        ),
        current: entry.uuid === current,
      }));
  });

  /** Lo que el cobro tiene aplicado hoy: la suma de lo que sus porciones sostienen. */
  protected readonly appliedAmount = computed(() =>
    round(this.siblings().reduce((total, sibling) => total + sibling.activeAmount, 0)),
  );

  /**
   * Cómo llegó la deuda a su pendiente, **con sus dos anclajes**.
   *
   * Sin el importe emitido y el pendiente de hoy la tarjeta es una lista de movimientos que no suma
   * a nada: son los dos números que hacen que el resto se pueda verificar.
   */
  protected readonly debtReconciliation = computed(() => {
    const debt = this.data.debt;
    if (!debt) {
      return null;
    }
    return { issued: debt.amount, pending: debt.pendingAmount };
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.failed.set(false);

    this.api
      .traceAllocation(this.currentUuid())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (trace) => {
          this.trace.set(trace);
          this.loading.set(false);
          this.loadCredit(trace.allocation.creditUuid);
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
        },
      });
  }

  /**
   * El cobro entero, en una sola llamada: su ficha trae los medios y **todas** sus imputaciones.
   *
   * Que falle no rompe la traza —es información de contexto, no la respuesta— así que el bloque
   * simplemente no se dibuja.
   */
  private loadCredit(creditUuid: string | null): void {
    if (!creditUuid) {
      this.credit.set(null);
      return;
    }

    this.api
      .getCredit(creditUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (credit) => this.credit.set(credit),
        error: () => this.credit.set(null),
      });
  }

  /** Saltar a otra porción del mismo cobro sin cerrar el diálogo. */
  protected onOpenSibling(sibling: SiblingAllocation): void {
    if (sibling.current) {
      return;
    }
    this.currentUuid.set(sibling.entry.uuid);
    this.trace.set(null);
    this.load();
  }

  /** La sangría del paso, en `rem`. Un salto por nivel: la forma es la que cuenta la historia. */
  protected indentOf(depth: number): string {
    return `${Math.min(depth, 6) * 1.25}rem`;
  }

  protected isReversal(entry: CheckingAccountAllocationRowDto): boolean {
    return entry.entryType === 'REVERSAL';
  }

  /**
   * Lo que una fila le mueve **al pendiente de la deuda**, que es el signo contrario al del libro.
   *
   * `signedAmount` es `+` en una imputación porque así lo lee el crédito; desde la deuda esa misma
   * imputación **baja** lo que se debe. Pintarla en verde con un más al lado se leía como si la
   * deuda hubiera crecido.
   */
  protected debtEffectOf(entry: CheckingAccountAllocationRowDto): number {
    return -entry.signedAmount;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
