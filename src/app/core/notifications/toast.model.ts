import {
  MatSnackBarHorizontalPosition,
  MatSnackBarVerticalPosition,
} from '@angular/material/snack-bar';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** Optional bold headline shown above the message. */
  title?: string;
  /** Milliseconds before auto-dismiss. Use `0` to keep the toast open. */
  duration?: number;
  /** Material Icons ligature. Defaults to the icon of the toast type. */
  icon?: string;
  /** Hides the close button when `false`. */
  dismissible?: boolean;
  horizontalPosition?: MatSnackBarHorizontalPosition;
  verticalPosition?: MatSnackBarVerticalPosition;
  /** Extra panel classes appended to `toast-panel` and `toast-<type>`. */
  panelClass?: string | string[];
}

export interface ToastData {
  type: ToastType;
  message: string;
  title?: string;
  icon: string;
  dismissible: boolean;
  dismissLabel: string;
}
