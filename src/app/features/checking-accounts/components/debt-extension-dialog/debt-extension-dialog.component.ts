import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DATE_LOCALE, provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
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
import { LanguageService } from '../../../../core/i18n/language.service';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  CheckingAccountDebtRowDto,
  addDays,
  daysBetween,
  parseIsoDate,
  toIsoDate,
  todayIso,
} from '../../data-access/checking-account.model';

export interface DebtExtensionDialogData {
  debt: CheckingAccountDebtRowDto;
}

export interface DebtExtensionDialogResult {
  dateDue: string;
  reason: string;
}

const MIN_REASON_LENGTH = 5;
/** Propuesta por defecto: dos semanas más sobre el vencimiento vigente. */
const DEFAULT_EXTENSION_DAYS = 14;

/**
 * Prorrogar el vencimiento de una deuda (§6).
 *
 * No es editar el documento: es un acto aparte, con permiso propio y motivo obligatorio, y el
 * diálogo lo dice mostrando el vencimiento **original** al lado del vigente. Esa distinción es la
 * que después deja leer la mora con honestidad — «venció y se prorrogó» no es «vencía más tarde».
 */
@Component({
  selector: 'app-debt-extension-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDatepickerModule,
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
  // El calendario nativo cae al locale del navegador, que en una máquina en inglés muestra
  // `8/24/2026` en una pantalla que el resto del tiempo escribe en español. Se le pasa el mismo
  // locale que usa `LocalizedDatePipe`, así la fecha se lee igual en toda la app.
  providers: [
    provideNativeDateAdapter(),
    { provide: MAT_DATE_LOCALE, useFactory: () => inject(LanguageService).localeId() },
  ],
  templateUrl: './debt-extension-dialog.component.html',
  styleUrl: './debt-extension-dialog.component.css',
})
export class DebtExtensionDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<DebtExtensionDialogComponent, DebtExtensionDialogResult>>(MatDialogRef);
  protected readonly data = inject<DebtExtensionDialogData>(MAT_DIALOG_DATA);

  protected readonly today = todayIso();
  /** El nuevo vencimiento sólo puede ir hacia adelante, y nunca al pasado. */
  protected readonly minDate = parseIsoDate(
    daysBetween(this.data.debt.dateDue, this.today) > 0
      ? addDays(this.today, 1)
      : addDays(this.data.debt.dateDue, 1),
  );

  protected readonly newDate = signal<Date>(
    parseIsoDate(addDays(this.data.debt.dateDue, DEFAULT_EXTENSION_DAYS)),
  );
  protected readonly reason = signal('');

  /**
   * Que el original difiera del vigente es lo que delata una prórroga anterior, y por eso el diálogo
   * lo dice: prorrogar por segunda vez es una decisión distinta a prorrogar por primera.
   */
  protected readonly wasExtended =
    this.data.debt.dateDueOriginal !== null &&
    this.data.debt.dateDue !== this.data.debt.dateDueOriginal;

  protected readonly extraDays = computed(() =>
    daysBetween(this.data.debt.dateDue, toIsoDate(this.newDate())),
  );

  protected readonly canSubmit = computed(
    () => this.extraDays() > 0 && this.reason().trim().length >= MIN_REASON_LENGTH,
  );

  protected onDateChange(value: Date | null): void {
    if (value) {
      this.newDate.set(value);
    }
  }

  protected onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }

    this.dialogRef.close({
      dateDue: toIsoDate(this.newDate()),
      reason: this.reason().trim(),
    });
  }
}
