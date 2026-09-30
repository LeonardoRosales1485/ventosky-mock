import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import {
  CashRegisterDto,
  hasOpenSession,
} from '../../../../core/cash-session/cash-session.model';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { VoidCreditRequest, VoidPreviewDto } from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';
import { DebtStateChipComponent } from '../debt-state-chip/debt-state-chip.component';

export interface VoidCreditDialogData {
  creditUuid: string;
  publicId: string | null;
}

export type VoidCreditDialogResult = VoidCreditRequest;

const REASON_MIN_LENGTH = 5;

/**
 * Anular un cobro (§13.5).
 *
 * **Es la operación de más impacto del módulo**, y el diálogo tiene que decirlo con datos y no con
 * un cartel de advertencia: qué deudas vuelven a quedar impagas, en qué estado quedan, cuánto sale
 * de la caja y en cuánto queda el saldo. Es el aviso que evita la llamada del cliente al día
 * siguiente.
 *
 * **La previa la calcula el backend.** Que una deuda vuelva a estar `VENCIDA` se evalúa contra la
 * fecha de hoy, y derivarlo acá dejaría que un reloj corrido mostrara un aviso que el sistema no
 * comparte — el mismo criterio que el diálogo de desimputación.
 *
 * **Anular no es desimputar**, y el diálogo usa la palabra que corresponde: desimputar deshace el
 * vínculo con una deuda y no mueve ni el saldo ni la caja; esto deshace el ingreso de dinero.
 *
 * **La plata sale del cajón que está abierto ahora**, no de la sesión en la que entró. Imputarla a
 * una sesión ya cerrada y arqueada dejaría un arqueo firmado que deja de cuadrar, así que sin
 * sesión abierta el diálogo frena y dice qué hacer — no es un error de formulario, no hay nada que
 * corregir acá. Un cobro que no movió caja —por transferencia, o una nota de crédito— se anula sin
 * sesión.
 */
@Component({
  selector: 'app-void-credit-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    CurrencyDisplayComponent,
    DebtStateChipComponent,
  ],
  templateUrl: './void-credit-dialog.component.html',
  styleUrl: './void-credit-dialog.component.css',
})
export class VoidCreditDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<VoidCreditDialogComponent, VoidCreditDialogResult>>(MatDialogRef);
  private readonly api = inject(CheckingAccountsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<VoidCreditDialogData>(MAT_DIALOG_DATA);

  protected readonly reason = signal('');
  protected readonly preview = signal<VoidPreviewDto | null>(null);
  protected readonly loading = signal(true);

  /** La caja preasignada del usuario, con su sesión. Nulo mientras no se resolvió. */
  protected readonly cashRegister = signal<CashRegisterDto | null>(null);

  /** Un cobro sin imputar no deja ninguna deuda impaga: se anula igual, y conviene decirlo. */
  protected readonly hasLines = computed(() => (this.preview()?.lines.length ?? 0) > 0);

  /** Sin medios que afecten caja no sale nada del cajón, y un aviso de caja ahí sería falso. */
  protected readonly touchesCash = computed(() => (this.preview()?.cashAmount ?? 0) > 0);

  /**
   * Falta la sesión que la anulación necesita.
   *
   * Sólo cuando sale plata del cajón: un cobro por transferencia no lo toca y no tiene por qué
   * esperar a que alguien abra una caja.
   */
  protected readonly missingCashSession = computed(
    () => this.touchesCash() && !hasOpenSession(this.cashRegister()),
  );

  protected readonly canSubmit = computed(
    () => this.reason().trim().length >= REASON_MIN_LENGTH && !this.missingCashSession(),
  );

  constructor() {
    this.api
      .previewVoid(this.data.creditUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.loading.set(false);
        },
        // Una previa que falla no bloquea la anulación: es información, no una validación. La regla
        // la aplica el backend igual.
        error: () => {
          this.preview.set(null);
          this.loading.set(false);
        },
      });

    // La caja se pide siempre y se usa sólo si sale plata: pedirla después de la previa encadenaría
    // dos viajes para un dato que el diálogo necesita al mismo tiempo.
    this.api
      .cashRegisterEntryContext()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (context) => this.cashRegister.set(context.cashRegister ?? null),
        error: () => this.cashRegister.set(null),
      });
  }

  protected onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.dialogRef.close({ reason: this.reason().trim() });
  }
}
