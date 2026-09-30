import { Component, computed, input, output, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { SALE_KEY_LABELS, SALE_SHORTCUTS } from '../../data-access/sale-shortcuts';
import { SaleCartLineView, SalePriceListDto } from '../../data-access/sale.model';

/** Con qué valor el menú dice «que la resuelva el carrito», para que el `null` viaje entero. */
export const AUTO_PRICE_LIST_VALUE = null;

/**
 * Qué se le puede hacer a la línea marcada, y con qué tecla.
 *
 * Es el panel que convierte al teclado en la forma normal de trabajar: la línea se elige con las
 * flechas y todo lo que se le puede hacer está acá, cada acción con su tecla escrita al lado. Los
 * botones no son un atajo del atajo —hacen exactamente lo mismo que la tecla— así que quien todavía
 * no las sabe trabaja con el mouse y las va leyendo.
 *
 * Ofrece sólo lo que la línea tiene: el lote aparece en un producto con partidas y con el permiso
 * para elegirlo, las series en uno serializado. Un botón apagado sin explicación manda al cajero a
 * adivinar cuál de sus productos es raro; no ofrecerlo dice que este producto no lleva lotes.
 */
@Component({
  selector: 'app-sale-line-actions',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslatePipe],
  templateUrl: './sale-line-actions.component.html',
  styleUrl: './sale-line-actions.component.css',
})
export class SaleLineActionsComponent {
  /** La línea marcada, o `null` con el carrito vacío. */
  readonly line = input<SaleCartLineView | null>(null);

  /** Qué número de fila es, para nombrarla: es como la lee el operador en la tabla. */
  readonly index = input(0);

  readonly priceLists = input<readonly SalePriceListDto[]>([]);

  /** `stock.batch_select`: sin el permiso el lote se ve en la fila pero no se elige (§7.3). */
  readonly canSelectBatch = input(false);

  readonly quantityEdit = output<void>();
  readonly priceListChange = output<string | null>();
  readonly batchPick = output<void>();
  readonly serialPick = output<void>();
  readonly remove = output<void>();

  private readonly priceListMenu = viewChild(MatMenuTrigger);

  protected readonly shortcuts = SALE_SHORTCUTS;
  protected readonly keyLabels = SALE_KEY_LABELS;

  protected readonly canChoosePriceList = computed(() => this.priceLists().length > 0);

  protected readonly showsBatch = computed(
    () => this.canSelectBatch() && this.line()?.batchTracked === true,
  );

  protected readonly showsSerials = computed(() => this.line()?.serialTracked === true);

  /** Con qué lista quedó la línea. `null` es «la que resuelva el carrito». */
  protected readonly chosenPriceListUuid = computed(() => this.line()?.chosenPriceListUuid ?? null);

  /**
   * Abre el menú de listas desde afuera: es lo que hace la tecla del atajo, que la atiende la
   * pantalla y no este panel —el teclado del punto de venta se maneja en un solo lugar—.
   */
  openPriceListMenu(): void {
    if (this.canChoosePriceList()) {
      this.priceListMenu()?.openMenu();
    }
  }

  protected isChosen(uuid: string | null): boolean {
    return this.chosenPriceListUuid() === uuid;
  }

  protected priceListName(uuid: string | null): string | null {
    return uuid === null
      ? null
      : (this.priceLists().find((list) => list.uuid === uuid)?.name ?? null);
  }

  protected readonly AUTO_PRICE_LIST_VALUE = AUTO_PRICE_LIST_VALUE;
}
