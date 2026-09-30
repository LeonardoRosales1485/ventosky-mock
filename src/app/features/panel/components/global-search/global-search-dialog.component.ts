import {
  Component,
  computed,
  inject,
  signal,
  viewChild,
  ElementRef,
  afterNextRender,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { NavService } from '../../data-access/nav.service';
import { NavSearchResult } from '../../data-access/nav.model';

@Component({
  selector: 'app-global-search-dialog',
  imports: [FormsModule, MatIconModule, TranslatePipe],
  templateUrl: './global-search-dialog.component.html',
  styleUrl: './global-search-dialog.component.css',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class GlobalSearchDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<GlobalSearchDialogComponent>);
  private readonly nav = inject(NavService);
  private readonly router = inject(Router);

  private readonly searchInput =
    viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);

  protected readonly results = computed(() => this.nav.search(this.query()));

  constructor() {
    afterNextRender(() => {
      this.searchInput().nativeElement.focus();
    });
  }

  protected onQueryChange(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  protected onDocumentKeydown(event: KeyboardEvent): void {
    const results = this.results();
    if (results.length === 0) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.update((index) => (index + 1) % results.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.update(
          (index) => (index - 1 + results.length) % results.length,
        );
        break;
      case 'Enter':
        event.preventDefault();
        this.navigateTo(results[this.activeIndex()]);
        break;
    }
  }

  protected navigateTo(result: NavSearchResult): void {
    void this.router.navigateByUrl(result.item.route);
    this.dialogRef.close();
  }

  protected setActiveIndex(index: number): void {
    this.activeIndex.set(index);
  }
}
