import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../shared/components/currency-display/currency-display.component';
import {
  ACCOUNT_DISABLED,
  AccountAvailabilityDto,
  DelinquencyLevel,
} from '../account-availability.model';
import { DelinquencyChipComponent } from '../delinquency-chip/delinquency-chip.component';

/**
 * El estado de la cuenta corriente del titular, junto a su nombre y **antes de cargar el carrito**
 * (§10.1).
 *
 * **Por qué antes y no al cobrar.** Enterarse de que el cliente está excedido después de cargar
 * veinte artículos es la peor versión de esta funcionalidad: el trabajo ya está hecho y lo único que
 * queda es deshacerlo delante de él.
 *
 * **El chip informa y no interrumpe.** Ninguno de los cuatro niveles deshabilita el medio de pago ni
 * pide confirmación; el cajero lee «MOROSO · $84.000 vencidos» y sigue, o levanta el teléfono. Lo
 * único que deshabilita el medio es que la cuenta esté deshabilitada, y eso se dice acá con su
 * motivo a la vista.
 *
 * **No calcula nada**: los cuatro números llegan resueltos de `/availability`. Si esta pantalla
 * dedujera el disponible restando por su cuenta, el día que cambie una regla del portón habría dos
 * versiones de la verdad y el panel prometería lo que el commit rechaza.
 *
 * **Es una foto.** Entre esta lectura y el commit puede entrar otra venta, y el que decide de verdad
 * es el portón: el panel adelanta la respuesta, no la reserva.
 *
 * **Sin cuenta el panel lo dice y no muestra un error.** «No puede llevar nada» y «no hay a quién
 * preguntarle» no son lo mismo, y si el cajero le vende a cuenta la cuenta se abre en el commit.
 */
@Component({
  selector: 'app-account-panel',
  imports: [
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    DelinquencyChipComponent,
  ],
  templateUrl: './account-panel.component.html',
  styleUrl: './account-panel.component.css',
})
export class AccountPanelComponent {
  /** Lo que contestó `/availability`. `null` mientras no hay titular elegido o la lectura falló. */
  readonly availability = input<AccountAvailabilityDto | null>(null);

  readonly loading = input(false);

  /**
   * El titular todavía no tiene cuenta corriente —un 404 de `/availability`—, que no es un error:
   * es el estado normal de alguien a quien nunca se le fió. El panel lo dice y no pinta un cartel
   * rojo; si le vende a cuenta, la cuenta se abre en el commit.
   */
  readonly noAccount = input(false);

  protected readonly level = computed<DelinquencyLevel>(
    () => (this.availability()?.delinquencyLevel as DelinquencyLevel | undefined) ?? 'AL_DIA',
  );

  protected readonly balance = computed(() => this.availability()?.balance ?? 0);

  protected readonly overdueAmount = computed(() => this.availability()?.overdueAmount ?? 0);

  /**
   * Si el panel tiene que hablar de topes.
   *
   * **En una compra no se muestra ni disponible ni límite** y no por ahorrar espacio: no hay nada
   * que consumir —cuánto nos fía un proveedor lo decide el proveedor—, y mostrar un límite que no se
   * valida es una invitación a que alguien lo implemente. El backend manda los dos en nulo
   * justamente para eso, así que alcanza con mirar lo que llegó.
   */
  protected readonly showsLimit = computed(() => this.availability()?.debtLimit != null);

  /** `null` = sin tope. Distinto de cero, que es «sin nada disponible». */
  protected readonly available = computed(() => this.availability()?.available ?? null);

  /** El tope que le rige. Va al lado del disponible: el disponible sale de restarle el saldo. */
  protected readonly debtLimit = computed(() => this.availability()?.debtLimit ?? null);

  /**
   * La cuenta apagada. Es lo único que el panel informa como un bloqueo, porque es lo único que
   * bloquea: el exceso de límite se resuelve en el cobro —proponiendo el disponible y dividiendo el
   * pago—, no negando la venta de entrada.
   */
  protected readonly disabled = computed(
    () => this.availability()?.blockedReason === ACCOUNT_DISABLED,
  );
}
