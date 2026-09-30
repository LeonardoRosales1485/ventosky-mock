import { Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslatePipe } from '@ngx-translate/core';
import { GlobalProgressService } from './global-progress.service';

@Component({
  selector: 'app-global-progress-bar',
  imports: [MatProgressBarModule, TranslatePipe],
  template: `
    @if (progress.active()) {
      <div class="global-progress-overlay" aria-busy="true">
        <mat-progress-bar
          class="global-progress-bar"
          mode="indeterminate"
          [attr.aria-label]="'progress.loading' | translate"
        />
      </div>
    }
  `,
  styles: `
    :host {
      display: contents;
    }

    /*
      Sits above the CDK overlay container (z-index 1000) so dialogs, menus and
      snackbars are blocked too. Being the topmost element with pointer events
      enabled, it swallows every click/tap meant for the UI behind it.
    */
    .global-progress-overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      pointer-events: auto;
      cursor: wait;
      background-color: transparent;
      /*
        Blocking is immediate, but the scrim only fades in once the request is
        slow enough to be worth signalling, so quick calls don't flash a tint.
      */
      animation: global-progress-scrim-in 150ms ease-out 400ms forwards;
    }

    @keyframes global-progress-scrim-in {
      to {
        background-color: light-dark(rgb(0 0 0 / 0.08), rgb(0 0 0 / 0.28));
      }
    }

    .global-progress-bar {
      position: absolute;
      inset-inline: 0;
      top: 0;
      --mat-progress-bar-track-height: 3px;
      --mat-progress-bar-active-indicator-height: 3px;
    }
  `,
})
export class GlobalProgressBarComponent {
  protected readonly progress = inject(GlobalProgressService);
}
