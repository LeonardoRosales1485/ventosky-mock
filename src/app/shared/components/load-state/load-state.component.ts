import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { LoadState } from './load-state.model';

/**
 * Renders the projected content only while the state is `Success`, and a
 * placeholder message for every other state.
 */
@Component({
  selector: 'app-load-state',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './load-state.component.html',
  styleUrl: './load-state.component.css',
})
export class LoadStateComponent {
  readonly state = input.required<LoadState>();

  /** Placeholder copy. Each one falls back to its `loadState.*` translation. */
  readonly idleMessage = input<string>();
  readonly loadingMessage = input<string>();
  readonly errorMessage = input<string>();

  readonly idleIcon = input('inbox');
  readonly errorIcon = input('error_outline');

  /** Shows a retry button on the error state that only emits `retry`. */
  readonly retryable = input(false);
  readonly retryLabel = input<string>();

  /** Min height of the placeholder area (any valid CSS length). */
  readonly minHeight = input('12rem');

  readonly retry = output<void>();

  protected readonly LoadState = LoadState;
}
