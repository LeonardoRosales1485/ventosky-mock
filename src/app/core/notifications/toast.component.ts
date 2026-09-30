import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { ToastData } from './toast.model';

@Component({
  selector: 'app-toast',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="toast">
      <mat-icon class="toast__icon" aria-hidden="true">{{ data.icon }}</mat-icon>

      <div class="toast__content">
        @if (data.title) {
          <p class="toast__title">{{ data.title }}</p>
        }
        <p class="toast__message">{{ data.message }}</p>
      </div>

      @if (data.dismissible) {
        <button
          type="button"
          class="toast__close"
          mat-icon-button
          [attr.aria-label]="data.dismissLabel"
          (click)="dismiss()"
        >
          <mat-icon aria-hidden="true">close</mat-icon>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.875rem 0.5rem 0.875rem 1rem;
      color: var(--toast-on-container);
    }

    .toast__icon {
      flex: none;
      color: var(--toast-accent);
    }

    .toast__content {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding-block: 0.125rem;
    }

    .toast__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }

    .toast__message {
      margin: 0;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .toast__close {
      flex: none;
      color: inherit;
      --mat-icon-button-state-layer-color: currentColor;
      --mat-icon-button-ripple-color: currentColor;
    }
  `,
})
export class ToastComponent {
  private readonly snackBarRef = inject<MatSnackBarRef<ToastComponent>>(MatSnackBarRef);

  protected readonly data = inject<ToastData>(MAT_SNACK_BAR_DATA);

  protected dismiss(): void {
    this.snackBarRef.dismiss();
  }
}
