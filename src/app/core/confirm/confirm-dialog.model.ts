export type ConfirmDialogColor = 'primary' | 'accent' | 'warn';

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: ConfirmDialogColor;
}

export type ConfirmDialogData = Required<
  Pick<ConfirmDialogOptions, 'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'confirmColor'>
>;
