import { Component, computed, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/** `square` keeps the given width/height with rounded corners; `circle` forces a 1:1 dot. */
export type SkeletonShape = 'square' | 'circle';

@Component({
  selector: 'app-skeleton',
  imports: [TranslatePipe],
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.css',
})
export class SkeletonComponent {
  readonly shape = input<SkeletonShape>('square');

  /** Number of blocks to render. */
  readonly count = input(1);

  /** Any valid CSS length. On `circle`, `height` is the diameter and `width` is ignored. */
  readonly width = input('100%');
  readonly height = input('1rem');

  /** Corner radius of `square` blocks. */
  readonly radius = input('0.25rem');

  /** Space between blocks. */
  readonly gap = input('0.5rem');

  /** Lays the blocks out in a row instead of stacking them. */
  readonly inline = input(false);

  /** Width of the last `square` block, to mimic a shorter trailing line of text. */
  readonly lastWidth = input<string>();

  readonly animated = input(true);

  /** Announced by screen readers; falls back to the `skeleton.loading` translation. */
  readonly label = input<string>();

  protected readonly isCircle = computed(() => this.shape() === 'circle');

  protected readonly blocks = computed<readonly string[]>(() => {
    const count = Math.max(1, Math.trunc(this.count()));

    if (this.isCircle()) {
      return Array.from({ length: count }, () => this.height());
    }

    const width = this.width();
    const lastWidth = this.lastWidth();

    return Array.from({ length: count }, (_, index) =>
      lastWidth && index === count - 1 ? lastWidth : width,
    );
  });
}
