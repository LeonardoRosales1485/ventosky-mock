import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Observable, map } from 'rxjs';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import {
  ConfirmDialogData,
  ConfirmDialogOptions,
} from './confirm-dialog.model';

@Service()
export class ConfirmDialogService {
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  confirm(options: ConfirmDialogOptions = {}): Observable<boolean> {
    const data: ConfirmDialogData = {
      title: options.title ?? this.translate.instant('confirm.title'),
      message: options.message ?? this.translate.instant('confirm.message'),
      confirmLabel:
        options.confirmLabel ?? this.translate.instant('confirm.confirm'),
      cancelLabel:
        options.cancelLabel ?? this.translate.instant('confirm.cancel'),
      confirmColor: options.confirmColor ?? 'warn',
    };

    return this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
        ConfirmDialogComponent,
        {
          width: '24rem',
          maxWidth: '95vw',
          autoFocus: 'dialog',
          data,
        },
      )
      .afterClosed()
      .pipe(map((result) => result === true));
  }
}
