import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export type RowActionColor = 'primary' | 'accent' | 'warn';

export interface RowAction {
  id: string;
  icon: string;
  /** Sirve de `aria-label` y de tooltip, así que en una acción deshabilitada dice **por qué** lo está. */
  label: string;
  color?: RowActionColor;
  disabled?: boolean;
}

@Component({
  selector: 'app-row-actions',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './row-actions.component.html',
  styleUrl: './row-actions.component.css',
})
export class RowActionsComponent {
  readonly actions = input.required<readonly RowAction[]>();
  readonly ariaLabel = input<string>();

  readonly actionClick = output<string>();
}
