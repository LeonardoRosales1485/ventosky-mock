import { DestroyRef, Service, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { TranslateService } from '@ngx-translate/core';

const PAGINATOR_KEYS = [
  'paginator.itemsPerPage',
  'paginator.nextPage',
  'paginator.previousPage',
  'paginator.firstPage',
  'paginator.lastPage',
] as const;

@Service()
export class MatPaginatorI18n extends MatPaginatorIntl {
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    super();

    this.translate
      .stream([...PAGINATOR_KEYS])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((translations) => {
        this.itemsPerPageLabel = translations['paginator.itemsPerPage'];
        this.nextPageLabel = translations['paginator.nextPage'];
        this.previousPageLabel = translations['paginator.previousPage'];
        this.firstPageLabel = translations['paginator.firstPage'];
        this.lastPageLabel = translations['paginator.lastPage'];
        this.changes.next();
      });
  }

  override getRangeLabel = (
    page: number,
    pageSize: number,
    length: number,
  ): string => {
    if (length === 0 || pageSize === 0) {
      return this.translate.instant('paginator.rangeEmpty', { length });
    }

    const total = Math.max(length, 0);
    const start = page * pageSize;
    const end =
      start < total ? Math.min(start + pageSize, total) : start + pageSize;

    return this.translate.instant('paginator.range', {
      start: start + 1,
      end,
      length: total,
    });
  };
}
