import { Component, computed, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-table-toolbar',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  templateUrl: './table-toolbar.component.html',
  styleUrl: './table-toolbar.component.css',
})
export class TableToolbarComponent {
  /** Two-way bound global search value. */
  readonly search = model<string>('');

  /** Number of active filters; when greater than 0, shows the clear-filters action. */
  readonly activeFilters = input(0);

  readonly disabled = input(false);

  readonly searchPlaceholder = input<string>();
  readonly searchAriaLabel = input<string>();
  readonly refreshLabel = input<string>();
  readonly filtersLabel = input<string>();
  readonly clearFiltersLabel = input<string>();

  readonly refresh = output<void>();
  readonly filtersClick = output<void>();
  readonly clearFilters = output<void>();

  protected readonly hasActiveFilters = computed(() => this.activeFilters() > 0);
}
