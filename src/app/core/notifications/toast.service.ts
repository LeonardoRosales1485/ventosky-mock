import { Service, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { ToastComponent } from './toast.component';
import { ToastData, ToastOptions, ToastType } from './toast.model';

const TOAST_ICONS: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const TOAST_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  error: 6000,
  warning: 5000,
  info: 4000,
};

/** Errors and warnings interrupt the screen reader; the rest wait their turn. */
const ASSERTIVE_TYPES: readonly ToastType[] = ['error', 'warning'];

@Service()
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);

  success(message: string, options?: ToastOptions): MatSnackBarRef<ToastComponent> {
    return this.show('success', message, {
      title: this.translate.instant('toast.success'),
      ...options,
    });
  }

  error(message: string, options?: ToastOptions): MatSnackBarRef<ToastComponent> {
    return this.show('error', message, {
      title: this.translate.instant('toast.error'),
      ...options,
    });
  }

  warning(message: string, options?: ToastOptions): MatSnackBarRef<ToastComponent> {
    return this.show('warning', message, {
      title: this.translate.instant('toast.warning'),
      ...options,
    });
  }

  info(message: string, options?: ToastOptions): MatSnackBarRef<ToastComponent> {
    return this.show('info', message, { title: this.translate.instant('toast.info'), ...options });
  }

  show(
    type: ToastType,
    message: string,
    options: ToastOptions = {},
  ): MatSnackBarRef<ToastComponent> {
    const data: ToastData = {
      type,
      message,
      title: options.title,
      icon: options.icon ?? TOAST_ICONS[type],
      dismissible: options.dismissible ?? true,
      dismissLabel: this.translate.instant('toast.close'),
    };

    return this.snackBar.openFromComponent(ToastComponent, {
      data,
      duration: options.duration ?? TOAST_DURATIONS[type],
      horizontalPosition: options.horizontalPosition ?? 'end',
      verticalPosition: options.verticalPosition ?? 'top',
      politeness: ASSERTIVE_TYPES.includes(type) ? 'assertive' : 'polite',
      panelClass: ['toast-panel', `toast-${type}`, ...normalizeClasses(options.panelClass)],
    });
  }

  dismiss(): void {
    this.snackBar.dismiss();
  }
}

function normalizeClasses(panelClass: string | string[] | undefined): string[] {
  if (!panelClass) {
    return [];
  }

  return Array.isArray(panelClass) ? panelClass : [panelClass];
}
