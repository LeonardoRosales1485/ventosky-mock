import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { LoadStateComponent } from '../../../../shared/components/load-state/load-state.component';
import { LoadState } from '../../../../shared/components/load-state/load-state.model';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  StockTransferDetail,
  StockTransferLine,
  anyLineHasBatch,
  anyLineHasExpiration,
  unitAbbrevKey,
} from '../../data-access/stock-transfer.model';
import { StockTransfersApiService } from '../../data-access/stock-transfers-api.service';
import {
  STOCK_TRANSFERS_PATH,
  stockTransferDetailPath,
} from '../../stock-transfers.paths';

/**
 * El remito de traslado: el papel que acompaña la mercadería.
 *
 * Es el mismo traslado del detalle, impreso. Se firma en las dos puntas —quien despacha y quien
 * recibe— y esa firma es el respaldo de la diferencia si en destino falta algo, así que la hoja
 * lleva un renglón de firma aunque en pantalla no signifique nada.
 *
 * **Los costos no se imprimen.** El remito viaja con la mercadería y lo lee quien la transporta y
 * quien la recibe; el costo de entrada de cada lote es información interna que no tiene por qué ir
 * arriba de un camión. El detalle sí los muestra, que es donde corresponde.
 */
@Component({
  selector: 'app-stock-transfer-remito-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    LoadStateComponent,
    LocalizedDatePipe,
  ],
  providers: [StockTransfersApiService],
  templateUrl: './stock-transfer-remito.page.html',
  styleUrl: './stock-transfer-remito.page.css',
})
export class StockTransferRemitoPage implements OnInit {
  private readonly api = inject(StockTransfersApiService);
  private readonly translate = inject(TranslateService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly uuid = this.route.snapshot.paramMap.get('uuid') ?? '';

  protected readonly loadState = signal(LoadState.Loading);
  protected readonly transfer = signal<StockTransferDetail | null>(null);

  protected readonly totalQuantity = computed(() =>
    (this.transfer()?.lines ?? []).reduce((total, line) => total + (line.quantity ?? 0), 0),
  );

  /**
   * Las columnas de partida van **sólo si alguna línea las usa**. En el papel importa más que en la
   * pantalla: el ancho es fijo, y dos columnas de guiones se lo sacan al nombre del producto y a las
   * series, que es lo que quien recibe realmente coteja contra las cajas.
   */
  protected readonly showBatch = computed(() => anyLineHasBatch(this.transfer()?.lines));

  protected readonly showExpiration = computed(() => anyLineHasExpiration(this.transfer()?.lines));

  /** Lo que abarca el «Total» del pie: todo lo que hay antes de la cantidad. */
  protected readonly footerColspan = computed(
    () => 2 + (this.showBatch() ? 1 : 0) + (this.showExpiration() ? 1 : 0),
  );

  /** La unidad con la que se lee la cantidad de una línea. Vacío si el producto no declara una. */
  protected unitOf(line: StockTransferLine): string {
    const key = unitAbbrevKey(line);
    return key ? this.translate.instant(key) : '';
  }

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.stockTransfers', link: STOCK_TRANSFERS_PATH },
      {
        label: this.transfer()?.publicId ?? '',
        link: stockTransferDetailPath(this.uuid),
      },
      { labelKey: 'stockTransfers.remito.title' },
    ]);
  }

  ngOnInit(): void {
    this.load();
  }

  protected onRetry(): void {
    this.load();
  }

  protected onBack(): void {
    void this.router.navigate([stockTransferDetailPath(this.uuid)]);
  }

  /**
   * Imprime con el diálogo del navegador. No se genera un PDF acá: el remito es una hoja simple, y
   * el `@media print` de esta pantalla ya la deja lista —sin menú, sin barra, sin botones—.
   */
  protected onPrint(): void {
    window.print();
  }

  private load(): void {
    this.loadState.set(LoadState.Loading);

    this.api
      .getByUuid(this.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (transfer) => {
          this.transfer.set(transfer);
          this.loadState.set(LoadState.Success);
        },
        error: () => this.loadState.set(LoadState.Error),
      });
  }

  /** Traducción resuelta, para lo que el template necesita como texto plano. */
  protected label(key: string): string {
    return this.translate.instant(`stockTransfers.remito.${key}`);
  }
}
