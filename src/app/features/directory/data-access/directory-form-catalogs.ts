import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { BranchDto } from '../../../core/branch/branch.model';
import { BranchesApiService } from '../../../core/branch/branches-api.service';
import { DirectoryLink } from '../../../core/parties/directory-links';
import {
  DirectoryCatalogApiService,
  DirectoryPriceListOption,
} from './directory-catalog-api.service';
import { DirectoryCatalogNeeds, catalogsFor } from './directory-forms';

/**
 * Las opciones de los selects de las fichas —sucursales y listas de precios—, pedidas **una sola vez** y sólo
 * cuando un vínculo del formulario las usa. Un formulario puede sumar vínculos mientras se completa —los que piden
 * los roles que se eligen—, y cada uno trae lo suyo al aparecer.
 *
 * Si un catálogo no se puede leer, su select queda vacío y el alta sigue: cada lectura pide su propio permiso.
 * Se provee en el componente del formulario, que es quien lo usa y quien lo descarta.
 */
@Injectable()
export class DirectoryFormCatalogs {
  private readonly catalog = inject(DirectoryCatalogApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly branches = signal<BranchDto[]>([]);
  readonly priceLists = signal<DirectoryPriceListOption[]>([]);

  private readonly requested = new Set<keyof DirectoryCatalogNeeds>();

  /** Trae lo que usan los campos de esos vínculos y todavía no se pidió. */
  requireFor(links: readonly DirectoryLink[]): void {
    const needs = catalogsFor(links);
    if (needs.branches) {
      this.loadOnce('branches', this.branchesApi.listAvailable(), this.branches);
    }
    if (needs.priceLists) {
      this.loadOnce('priceLists', this.catalog.priceLists(), this.priceLists);
    }
  }

  private loadOnce<T>(
    key: keyof DirectoryCatalogNeeds,
    source: Observable<T[]>,
    target: { set(value: T[]): void },
  ): void {
    if (this.requested.has(key)) {
      return;
    }
    this.requested.add(key);
    source.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => target.set(items),
      error: () => target.set([]),
    });
  }
}
