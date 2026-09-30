import { Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormField, form, maxLength, required, submit } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { PriceListDto } from '../../data-access/price-list.model';

export interface PriceListFormDialogData {
  priceList: PriceListDto | null;
  /**
   * Marcar o desmarcar la lista principal es exclusivo de SysAdmin. Sin el permiso el toggle se
   * muestra deshabilitado en su valor vigente: el backend sólo valida cuando el valor cambia, así
   * que reenviarlo igual no dispara el 403.
   */
  canSetPrincipal: boolean;
}

export interface PriceListFormDialogResult {
  uuid?: string;
  name: string;
  isPrincipal: boolean;
  isActive: boolean;
  /**
   * Versión que traía la lista al abrir el diálogo, para que el guardado la reenvíe y el backend
   * pueda detectar si alguien más la editó mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface PriceListFormModel {
  name: string;
  isPrincipal: boolean;
  isActive: boolean;
}

const NAME_MAX_LENGTH = 255;

@Component({
  selector: 'app-price-list-form-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './price-list-form-dialog.component.html',
  styleUrl: './price-list-form-dialog.component.css',
})
export class PriceListFormDialogComponent {
  private readonly dialogRef = inject(
    MatDialogRef<PriceListFormDialogComponent, PriceListFormDialogResult>,
  );
  private readonly data = inject<PriceListFormDialogData>(MAT_DIALOG_DATA);

  protected readonly isEdit = this.data.priceList !== null;
  protected readonly canSetPrincipal = this.data.canSetPrincipal;

  private readonly model = signal<PriceListFormModel>({
    name: this.data.priceList?.name ?? '',
    isPrincipal: this.data.priceList?.isPrincipal === true,
    isActive: this.data.priceList?.isActive !== false,
  });

  protected readonly priceListForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);
  });

  protected onActiveChange(checked: boolean): void {
    this.priceListForm.isActive().value.set(checked);
  }

  protected onPrincipalChange(checked: boolean): void {
    this.priceListForm.isPrincipal().value.set(checked);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.priceListForm().invalid()) {
      this.priceListForm().markAsTouched();
      return;
    }

    void submit(this.priceListForm, async () => {
      const value = this.model();
      const name = value.name.trim();
      if (!name) {
        return;
      }

      this.dialogRef.close({
        uuid: this.data.priceList?.uuid,
        name,
        isPrincipal: value.isPrincipal,
        isActive: value.isActive,
        version: this.data.priceList?.version,
      });
    });
  }
}
