import { Service, computed, signal } from '@angular/core';

@Service()
export class GlobalProgressService {
  private readonly pending = signal(0);

  readonly active = computed(() => this.pending() > 0);

  show(): void {
    this.pending.update((count) => count + 1);
  }

  hide(): void {
    this.pending.update((count) => Math.max(0, count - 1));
  }

  reset(): void {
    this.pending.set(0);
  }
}
