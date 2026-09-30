import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { OpeningBalanceApiService } from '../../data-access/opening-balance-api.service';
import {
  OpeningImportDto,
  OpeningImportRowDto,
  OpeningLineRequest,
  OpeningPreviewDto,
} from '../../data-access/opening-balance.model';
import { OpeningCsvError, parseOpeningCsv } from '../../data-access/opening-csv';

/**
 * Carga de saldos iniciales: la deuda que ya existía el día que el módulo arranca.
 *
 * **Una partida por deuda y no un importe único de apertura.** El vencido, la morosidad, el aviso de
 * deuda y el corte por límite se calculan los cuatro sobre el vencimiento: con un solo número los
 * cuatro contestarían que no hay nada vencido durante todo el primer año, que es justo el año en que
 * la deuda vieja es la que importa.
 *
 * **Dos pasos, siempre.** Primero la previa —qué se va a cargar, en qué cuentas y por cuánto, sin
 * escribir nada— y recién después la carga. El saldo inicial es el único dato del módulo que después
 * no se compara contra nada: una venta tiene su orden, un cobro su movimiento de caja. Éste no tiene
 * contra qué contrastarse, así que si entra mal entra mal para siempre y ésta es la única oportunidad
 * de revisarlo que va a existir.
 *
 * **Cargar dos veces no duplica.** El botón no se bloquea después de cargar: la carga saltea lo que
 * ya existe y devuelve cuántas creó y cuántas salteó. Bloquearlo sería fingir una garantía que en
 * realidad da el backend.
 *
 * **Una línea mala frena el lote entero.** Cargar «las 37 que estaban bien» dejaría un saldo inicial
 * parcial que nadie sabe que lo es, justo sobre el dato que después no se puede auditar contra nada.
 *
 * **El historial contesta «estas 40 deudas, ¿de dónde salieron?»**, que sobre un saldo inicial no lo
 * contesta ningún otro dato del módulo. Sus totales se guardan y no se recalculan: son los que una
 * persona aprobó en la previa.
 */
@Component({
  selector: 'app-opening-balance-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
  ],
  providers: [OpeningBalanceApiService],
  templateUrl: './opening-balance.page.html',
  styleUrl: './opening-balance.page.css',
})
export class OpeningBalancePage {
  private readonly api = inject(OpeningBalanceApiService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly csv = signal('');
  protected readonly sourceName = signal('');
  protected readonly parseErrors = signal<readonly OpeningCsvError[]>([]);
  protected readonly preview = signal<OpeningPreviewDto | null>(null);
  protected readonly result = signal<OpeningImportDto | null>(null);
  protected readonly busy = signal(false);

  /** Las cargas ya hechas. Se piden a demanda: no hacen falta para armar el archivo. */
  protected readonly history = signal<readonly OpeningImportRowDto[]>([]);
  protected readonly historyOpen = signal(false);

  /** Las líneas que el archivo dejó armadas. Es lo que se manda, y lo que la previa mide. */
  private readonly lines = signal<readonly OpeningLineRequest[]>([]);

  protected readonly canPreview = computed(() => this.csv().trim().length > 0 && !this.busy());

  /**
   * Cargar exige una previa **de este mismo texto**: cualquier edición del CSV la borra. Una previa
   * que habla de otro archivo es peor que ninguna.
   */
  protected readonly canImport = computed(() => !!this.preview()?.canImport && !this.busy());

  /**
   * Qué porcentaje de lo que se va a cargar nace ya vencido.
   *
   * Es el número que sorprende —suele ser la mitad— y verlo antes evita el susto de que el módulo
   * arranque mandando avisos de deuda. El porcentaje se saca sobre la deuda, no sobre el total: lo
   * que entra a favor no puede estar vencido.
   */
  protected readonly overduePercent = computed(() => {
    const preview = this.preview();
    if (!preview || preview.totalDebt <= 0) {
      return null;
    }
    return Math.round((preview.totalOverdue / preview.totalDebt) * 100);
  });

  constructor() {
    this.breadcrumb.publish(() => [BREADCRUMB_HOME, { labelKey: 'openingBalance.title' }]);
  }

  /** El historial se pide una sola vez y se conserva: no cambia mientras se arma el archivo. */
  protected onToggleHistory(): void {
    this.historyOpen.update((open) => !open);

    if (this.historyOpen() && this.history().length === 0) {
      this.api
        // La última carga primero: el historial se abre para ver qué se hizo recién, y la primera
        // carga de la empresa —la más vieja— es justo la que nadie está buscando.
        .history({
          page: 1,
          size: 20,
          ordenes: [{ tabla: 't', columna: 'date_created', direccion: 'DESC' }],
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (page) => this.history.set(page.content ?? []),
          error: () => this.history.set([]),
        });
    }
  }

  protected onCsvChange(text: string): void {
    this.csv.set(text);
    this.preview.set(null);
    this.result.set(null);
    this.parseErrors.set([]);
  }

  /** El archivo se lee acá: lo que viaja son líneas ya estructuradas, nunca el archivo. */
  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.sourceName.set(file.name);
    file
      .text()
      .then((text) => this.onCsvChange(text))
      .catch(() => this.toast.error(this.translate.instant('openingBalance.errors.file')));
  }

  protected onPreview(): void {
    if (!this.canPreview()) {
      return;
    }
    const parsed = parseOpeningCsv(this.csv());
    this.parseErrors.set(parsed.errors);
    this.lines.set(parsed.lines);
    this.result.set(null);
    if (parsed.lines.length === 0) {
      this.preview.set(null);
      this.toast.error(this.translate.instant('openingBalance.errors.empty'));
      return;
    }

    this.busy.set(true);
    this.api
      .preview({ sourceName: this.sourceName() || undefined, lines: parsed.lines })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.busy.set(false);
          this.preview.set(preview);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.preview.set(null);
          this.toast.error(this.messageOf(error, 'openingBalance.errors.preview'));
        },
      });
  }

  /**
   * Carga.
   *
   * Deja la previa en pantalla junto al resultado: después de cargar, «qué se cargó» y «qué había
   * para cargar» son la misma pregunta, y borrarla obligaría a rehacerla para contestarla.
   */
  protected onImport(): void {
    if (!this.canImport()) {
      return;
    }
    this.busy.set(true);
    this.api
      .execute({ sourceName: this.sourceName() || undefined, lines: this.lines() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.result.set(result);
          this.toast.success(
            this.translate.instant('openingBalance.imported', {
              created: result.createdCount,
              skipped: result.skippedCount,
            }),
          );
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.toast.error(this.messageOf(error, 'openingBalance.errors.import'));
        },
      });
  }

  /**
   * El backend contesta con el número de línea y el motivo —«Línea 12: falta el vencimiento»—, así
   * que su mensaje vale mucho más que uno genérico: sin él, corregir un archivo de 400 filas es
   * adivinar.
   */
  private messageOf(error: unknown, fallbackKey: string): string {
    return error instanceof Error && error.message
      ? error.message
      : this.translate.instant(fallbackKey);
  }
}
