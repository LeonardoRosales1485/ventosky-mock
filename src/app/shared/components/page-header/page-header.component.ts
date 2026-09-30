import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-page-header',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.css',
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly description = input<string>();

  /** When true, shows a back button that only emits `back`. */
  readonly showBack = input(false);
  readonly backLabel = input<string>();

  readonly back = output<void>();
}
