import { Service, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { GlobalSearchDialogComponent } from './global-search-dialog.component';

const DIALOG_ID = 'global-search';

@Service()
export class GlobalSearchService {
  private readonly dialog = inject(MatDialog);

  open(): void {
    if (this.dialog.getDialogById(DIALOG_ID)) {
      return;
    }

    this.dialog.open(GlobalSearchDialogComponent, {
      id: DIALOG_ID,
      width: '36rem',
      maxWidth: '95vw',
      position: { top: '4rem' },
      autoFocus: false,
      restoreFocus: true,
      panelClass: 'global-search-dialog-panel',
    });
  }
}
