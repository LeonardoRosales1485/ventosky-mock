import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

/** How long the copy button keeps showing the "copied" confirmation. */
const COPIED_FEEDBACK_MS = 2000;

@Component({
  selector: 'app-email-display',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  templateUrl: './email-display.component.html',
  styleUrl: './email-display.component.css',
})
export class EmailDisplayComponent {
  private readonly clipboard = inject(Clipboard);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly translate = inject(TranslateService);

  readonly email = input<string | null | undefined>();

  /** Optional prefilled `mailto:` subject and body. */
  readonly subject = input<string>();
  readonly body = input<string>();

  readonly showCopy = input(true);
  readonly showSend = input(true);

  /** Truncates the address with an ellipsis and shows the full value on hover. */
  readonly truncate = input(false);

  /** Text shown when there is no address; defaults to the translated placeholder. */
  readonly emptyLabel = input<string>();

  readonly copied = output<string>();
  readonly copyFailed = output<string>();

  protected readonly value = computed(() => this.email()?.trim() ?? '');
  protected readonly hasValue = computed(() => this.value().length > 0);

  protected readonly mailtoHref = computed(() => {
    const value = this.value();

    if (!value) {
      return null;
    }

    const query = [this.queryParam('subject', this.subject()), this.queryParam('body', this.body())]
      .filter((part) => part !== null)
      .join('&');

    return `mailto:${encodeURIComponent(value)}${query ? `?${query}` : ''}`;
  });

  /** Signals the transient "copied" state of the copy button. */
  protected readonly justCopied = signal(false);

  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copiedTimer));
  }

  protected copy(): void {
    const value = this.value();

    if (!value) {
      return;
    }

    if (!this.clipboard.copy(value)) {
      this.announcer.announce(this.translate.instant('emailDisplay.copyError'), 'assertive');
      this.copyFailed.emit(value);
      return;
    }

    this.justCopied.set(true);
    this.announcer.announce(this.translate.instant('emailDisplay.copied'), 'polite');
    this.copied.emit(value);

    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.justCopied.set(false), COPIED_FEEDBACK_MS);
  }

  private queryParam(name: string, value: string | undefined): string | null {
    return value ? `${name}=${encodeURIComponent(value)}` : null;
  }
}
