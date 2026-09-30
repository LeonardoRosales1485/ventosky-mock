import { Component, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-table-wrapper',
  imports: [MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './table-wrapper.component.html',
  styleUrl: './table-wrapper.component.css',
})
export class TableWrapperComponent {
  readonly loading = input(false);
  readonly loadingAriaLabel = input<string>();

  /** Max height of the scrollable table body (any valid CSS length). */
  readonly maxHeight = input('28rem');
}
