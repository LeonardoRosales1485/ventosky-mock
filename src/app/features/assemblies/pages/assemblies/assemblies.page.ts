import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FilterMatchMode, PaginationFilterConstraint } from '../../../../core/paginate';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  ASSEMBLY_CANCEL_PERMISSION,
  ASSEMBLY_CREATE_PERMISSION,
  ASSEMBLY_DISASSEMBLE_PERMISSION,
  ASSEMBLY_STATUSES,
  AssemblyRow,
  isCancellable,
} from '../../data-access/assembly.model';
import { AssembliesApiService } from '../../data-access/assemblies-api.service';
import {
  ASSEMBLIES_DEFAULT_SORT_PARAM,
  createAssembliesPaginator,
} from '../../data-access/assemblies-list.query';
import {
  ASSEMBLIES_PATH,
  ASSEMBLY_TRACEABILITY_PATH,
  DISASSEMBLE_PATH,
  NEW_ASSEMBLY_PATH,
} from '../../assemblies.paths';

/**
 * El listado de armados (wireframe `1t`): qué se armó, cuánto salió y en qué estado quedó.
 *
 * La pantalla se ordena alrededor de una distinción que es fácil de perder: **cancelar y desarmar
 * no son la misma cosa**.
 *
 * - **Cancelar** revierte *ese documento* y por eso es una acción **de la fila**: devuelve los
 *   componentes a los lotes de los que salieron y saca las unidades producidas. Sólo si siguen
 *   enteras y sin vender.
 * - **Desarmar** rompe unidades sueltas que pueden venir de dos armados distintos, así que **no
 *   revierte nada** — y por eso es un botón **del encabezado** y no de la fila. Colgarlo de una fila
 *   diría lo contrario de lo que hace.
 *
 * El estado es sólo `HECHO` o `CANCELADO`: no hay armado en curso (RN-23). La columna existe igual
 * para el día que lo haya.
 */
@Component({
  selector: 'app-assemblies-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
    LocalizedDatePipe,
    CurrencyDisplayComponent,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
  ],
  providers: [AssembliesApiService],
  templateUrl: './assemblies.page.html',
  styleUrl: './assemblies.page.css',
})
export class AssembliesPage implements OnInit {
  private readonly api = inject(AssembliesApiService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly language = inject(LanguageService);

  protected readonly paginator = createAssembliesPaginator((query) => this.api.paginate(query));

  protected readonly canCreate = this.auth.hasPermission(ASSEMBLY_CREATE_PERMISSION);
  protected readonly canCancel = this.auth.hasPermission(ASSEMBLY_CANCEL_PERMISSION);
  protected readonly canDisassemble = this.auth.hasPermission(ASSEMBLY_DISASSEMBLE_PERMISSION);

  protected readonly statuses = ASSEMBLY_STATUSES;

  protected readonly displayedColumns = [
    'publicId',
    'dateCreated',
    'product',
    'quantity',
    'warehouse',
    'unitCost',
    'assemblyStatus',
    'actions',
  ];

  protected readonly pageSizeOptions = this.paginator.defaultPageSizeOptions;
  protected readonly searchQuery = signal(readQueryParam(this.route.snapshot.queryParams['q']));
  protected readonly statusFilter = signal<string | null>(null);
  protected readonly filtersOpen = signal(false);

  protected readonly activeFilters = computed(() => Object.keys(this.paginator.filters()).length);

  /** Mientras se cancela, la fila no ofrece repetir la acción. */
  private readonly cancellingUuid = signal<string | null>(null);

  /**
   * Las acciones de cada fila.
   *
   * Cancelar va apagado con el motivo por tooltip en vez de desaparecer: una fila sin el botón se
   * lee como «este armado no se puede cancelar nunca», y no como «éste ya está cancelado».
   */
  protected readonly rowActionsByUuid = computed<ReadonlyMap<string, readonly RowAction[]>>(() => {
    // El idioma entra como dependencia: las etiquetas se traducen acá, no con el pipe.
    this.language.currentLang();
    const cancelling = this.cancellingUuid();

    return new Map(
      this.paginator.items().map((assembly): [string, readonly RowAction[]] => {
        const cancellable = isCancellable(assembly);
        return [
          assembly.uuid,
          [
            {
              id: 'cancel',
              icon: 'undo',
              label: cancellable
                ? this.translate.instant('assemblies.list.actions.cancel')
                : this.translate.instant('assemblies.list.actions.cancelDone'),
              disabled: !this.canCancel || !cancellable || cancelling === assembly.uuid,
            },
            {
              id: 'trace',
              icon: 'account_tree',
              label: assembly.batchUuid
                ? this.translate.instant('assemblies.list.actions.trace')
                : this.translate.instant('assemblies.list.actions.traceUnavailable'),
              // Se apaga por el uuid de la partida y no por su número: la consulta va por lote, y
              // un armado sin partida —un terminado que no lleva— no tiene por dónde entrar.
              disabled: !assembly.batchUuid,
            },
          ],
        ];
      }),
    );
  });

  constructor() {
    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.paginator.setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.assemblies', link: ASSEMBLIES_PATH },
    ]);
  }

  ngOnInit(): void {
    const params: Params = {
      sort: ASSEMBLIES_DEFAULT_SORT_PARAM,
      ...this.route.snapshot.queryParams,
    };
    this.paginator.applyQueryParams(params);
    this.restoreFilterSelection();
  }

  protected onCreate(): void {
    void this.router.navigate([NEW_ASSEMBLY_PATH]);
  }

  /** Desarmar es del encabezado: no revierte un documento, así que no cuelga de ninguna fila. */
  protected onDisassemble(): void {
    void this.router.navigate([DISASSEMBLE_PATH]);
  }

  protected onRowAction(actionId: string, assembly: AssemblyRow): void {
    if (actionId === 'cancel') {
      this.confirmCancellation(assembly);
      return;
    }
    if (actionId === 'trace' && assembly.batchUuid) {
      void this.router.navigate([ASSEMBLY_TRACEABILITY_PATH], {
        queryParams: { produced: assembly.batchUuid },
      });
    }
  }

  protected rowActionsFor(assembly: AssemblyRow): readonly RowAction[] {
    return this.rowActionsByUuid().get(assembly.uuid) ?? [];
  }

  protected isCancelled(assembly: AssemblyRow): boolean {
    return assembly.assemblyStatus === 'CANCELLED';
  }

  protected onPage(event: PageEvent): void {
    this.paginator.handlePageEvent(event);
    void this.syncQueryParams();
  }

  protected onSort(sort: Sort): void {
    this.paginator.handleSortChange(sort);
    void this.syncQueryParams();
  }

  protected onRefresh(): void {
    this.paginator.refresh();
  }

  protected onToggleFilters(): void {
    this.filtersOpen.update((open) => !open);
  }

  protected onStatusChange(status: string | null): void {
    this.statusFilter.set(status);
    this.applyFilters();
  }

  protected onClearFilters(): void {
    this.statusFilter.set(null);
    this.paginator.clearFilters();
    void this.syncQueryParams();
  }

  /**
   * Cancelar mueve inventario en las dos direcciones —devuelve los componentes y saca lo
   * producido—, así que no se dispara sin confirmación, y el diálogo dice exactamente eso.
   *
   * También dice lo que la pantalla no puede saber sola: si las unidades ya salieron, el backend
   * responde `409` y lo que corresponde es **desarmar** las que queden.
   */
  private confirmCancellation(assembly: AssemblyRow): void {
    const label = assembly.publicId ?? this.translate.instant('assemblies.list.noPublicId');

    this.confirm
      .confirm({
        title: this.translate.instant('assemblies.cancel.title', { assembly: label }),
        message: this.translate.instant('assemblies.cancel.message', {
          quantity: assembly.quantity ?? 0,
          product: assembly.product?.name ?? '',
        }),
        confirmLabel: this.translate.instant('assemblies.cancel.confirm'),
        cancelLabel: this.translate.instant('assemblies.cancel.cancel'),
        confirmColor: 'warn',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.cancel(assembly);
        }
      });
  }

  private cancel(assembly: AssemblyRow): void {
    this.cancellingUuid.set(assembly.uuid);

    this.api
      .cancel(assembly.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancellingUuid.set(null);
          this.toast.success(this.translate.instant('assemblies.cancel.success'));
          this.paginator.refresh();
        },
        error: (error: unknown) => {
          this.cancellingUuid.set(null);
          this.toast.error(
            resolveApiErrorMessage(error, this.translate.instant('assemblies.cancel.error')),
          );
          // Las unidades pudieron venderse desde otra pantalla: lo que se ve ya no vale.
          this.paginator.refresh();
        },
      });
  }

  private applyFilters(): void {
    const filters: Record<string, PaginationFilterConstraint> = {};

    const status = this.statusFilter();
    if (status) {
      filters['assemblyStatus'] = { value: status, matchMode: FilterMatchMode.Equals };
    }

    this.paginator.setFilters(filters);
    void this.syncQueryParams();
  }

  /** Rehidrata el select con el filtro que el paginador restauró de la URL. */
  private restoreFilterSelection(): void {
    const status = firstConstraint(this.paginator.filters()['assemblyStatus']);
    this.statusFilter.set(typeof status?.value === 'string' ? status.value : null);
    this.filtersOpen.set(this.statusFilter() !== null);
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator.toQueryParams(),
      replaceUrl: true,
    });
  }
}

function firstConstraint(
  value: PaginationFilterConstraint | PaginationFilterConstraint[] | undefined,
): PaginationFilterConstraint | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function readQueryParam(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
