import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
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
import { TranslatePipe } from '@ngx-translate/core';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import { NoticePreviewDto, SendNoticeRequest } from '../../data-access/checking-account.model';
import { CheckingAccountsApiService } from '../../data-access/checking-accounts-api.service';

export interface DebtNoticeDialogData {
  accountUuid: string;
  partyName: string;
}

export type DebtNoticeDialogResult = SendNoticeRequest;

/**
 * Enviar un aviso de deuda (§9.4).
 *
 * **El sistema propone y la persona dispone.** El backend arma el detalle —qué comprobantes, por
 * cuánto, hace cuántos días—, que es la parte tediosa y en la que no se equivoca; el operador lo lee,
 * lo edita si hace falta y decide si eso es lo que corresponde decirle a este cliente hoy.
 *
 * **Ese paso es la funcionalidad, no un trámite.** No hay avisos automáticos porque el sistema no
 * sabe si la deuda está en discusión, si hay un acuerdo firmado o si el caso ya está en un estudio
 * jurídico: un mail de intimación a un cliente que arregló la semana pasada es la clase de error que
 * cuesta la cuenta, y lo manda el software en nombre de la empresa.
 *
 * **El destinatario es editable** y arranca en el mail del tercero. Un titular sin mail cargado no es
 * un error: el diálogo lo pide, porque «mandáselo a la casilla de administración» es una decisión del
 * momento y no un dato del maestro.
 */
@Component({
  selector: 'app-debt-notice-dialog',
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
    LocalizedDatePipe,
    CurrencyDisplayComponent,
  ],
  templateUrl: './debt-notice-dialog.component.html',
  styleUrl: './debt-notice-dialog.component.css',
})
export class DebtNoticeDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<DebtNoticeDialogComponent, DebtNoticeDialogResult>>(MatDialogRef);
  private readonly api = inject(CheckingAccountsApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<DebtNoticeDialogData>(MAT_DIALOG_DATA);

  protected readonly preview = signal<NoticePreviewDto | null>(null);
  protected readonly loading = signal(true);

  protected readonly recipient = signal('');
  protected readonly subject = signal('');
  protected readonly body = signal('');

  /** Sin deudas vencidas el aviso no tiene qué reclamar, y conviene decirlo antes de mandarlo. */
  protected readonly hasOverdue = computed(() => (this.preview()?.debts.length ?? 0) > 0);

  protected readonly canSubmit = computed(
    () =>
      this.recipient().trim().length > 0 &&
      this.subject().trim().length > 0 &&
      this.body().trim().length > 0,
  );

  constructor() {
    this.api
      .previewNotice(this.data.accountUuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.recipient.set(preview.recipient ?? '');
          this.subject.set(preview.subject);
          this.body.set(preview.body);
          this.loading.set(false);
        },
        // Sin propuesta no hay nada que revisar: el diálogo queda vacío y el botón, apagado. Mandar
        // un aviso con el texto en blanco sería peor que no mandarlo.
        error: () => {
          this.preview.set(null);
          this.loading.set(false);
        },
      });
  }

  protected onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.dialogRef.close({
      recipient: this.recipient().trim(),
      subject: this.subject().trim(),
      body: this.body().trim(),
    });
  }
}
