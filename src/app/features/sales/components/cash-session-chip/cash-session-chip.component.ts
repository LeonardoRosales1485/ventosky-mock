import { Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
  CashRegisterDto,
  hasOpenSession,
  openedByName,
} from '../../../../core/cash-session/cash-session.model';

/**
 * La caja contra la que se está por registrar la venta, y su sesión.
 *
 * Está a la vista permanentemente porque es la única condición de la venta que no depende del
 * carrito: sin una sesión que cubra el momento de la operación el commit responde 400, y eso hay
 * que saberlo antes de armar la venta, no después de cobrarla.
 *
 * Deja cambiar de caja cuando el usuario tiene más de una a mano y abrir la sesión cuando falta:
 * es lo único que destraba el estado que el chip está informando, y mandarlo al ABM de cajas para
 * eso sería mandarlo a otra pantalla a resolver lo que bloquea ésta. Cerrar no, que es el arqueo.
 */
@Component({
  selector: 'app-cash-session-chip',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, TranslatePipe],
  templateUrl: './cash-session-chip.component.html',
  styleUrl: './cash-session-chip.component.css',
})
export class CashSessionChipComponent {
  readonly cashRegister = input<CashRegisterDto | null>(null);

  /** Cajas entre las que se puede cambiar. Con una sola, el chip no ofrece menú. */
  readonly cashRegisters = input<readonly CashRegisterDto[]>([]);

  readonly loading = input(false);

  /** Si el usuario tiene `cash_register.open`. Sin el permiso el chip sólo informa. */
  readonly canOpen = input(false);

  /** Hay una apertura en curso: el botón se apaga para no disparar dos. */
  readonly opening = input(false);

  readonly cashRegisterChange = output<string>();

  readonly openSession = output<void>();

  protected readonly isReady = computed(() => hasOpenSession(this.cashRegister()));

  protected readonly openedBy = computed(() => openedByName(this.cashRegister()));

  protected readonly selectable = computed(() => this.cashRegisters().length > 1);

  /**
   * Cuándo ofrecer la apertura: hay una caja elegida, no tiene sesión y el usuario puede abrirla.
   * Con la caja abierta el botón sobra, y sin caja elegida no se sabe cuál abrir.
   */
  protected readonly canOfferOpen = computed(
    () => this.canOpen() && !this.loading() && this.cashRegister() !== null && !this.isReady(),
  );

  /** Qué falta: ninguna caja resuelta, o una caja sin sesión abierta. */
  protected readonly statusKey = computed(() => {
    if (this.loading()) {
      return 'sales.cashSession.loading';
    }

    if (!this.cashRegister()) {
      return 'sales.cashSession.none';
    }

    return this.isReady() ? 'sales.cashSession.active' : 'sales.cashSession.closed';
  });

  protected readonly isOpen = hasOpenSession;
}
