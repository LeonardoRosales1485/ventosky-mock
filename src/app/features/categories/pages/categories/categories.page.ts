import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkDragDrop, CdkDragMove, CdkDropList, transferArrayItem } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, finalize, switchMap } from 'rxjs';
import {
  GuardedSaveOutcome,
  VersionConflictService,
} from '../../../../core/concurrency/version-conflict.service';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { CATEGORIES_PATHS } from '../../categories.paths';
import {
  CategoryFormDialogComponent,
  CategoryFormDialogResult,
} from '../../components/category-form-dialog/category-form-dialog.component';
import { CategoryTreeNodeComponent } from '../../components/category-tree-node/category-tree-node.component';
import { CategoriesApiService } from '../../data-access/categories-api.service';
import {
  CategoryDto,
  CategorySavePayload,
  CategoryTreeNode,
  fromAllTreeDto,
  toTreeNode,
} from '../../data-access/category.model';

@Component({
  selector: 'app-categories-page',
  imports: [
    FormsModule,
    CdkDropList,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
    CategoryTreeNodeComponent,
  ],
  providers: [CategoriesApiService],
  templateUrl: './categories.page.html',
  styleUrl: './categories.page.css',
})
export class CategoriesPage implements OnInit {
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);

  private readonly treeRoot = viewChild<ElementRef<HTMLElement>>('treeRoot');

  protected readonly roots = signal<CategoryTreeNode[]>([]);
  protected readonly loading = signal(false);
  protected readonly filterQuery = signal('');
  protected readonly dragging = signal(false);
  protected readonly moving = signal(false);
  /** Nodo resaltado bajo el puntero durante el drag (futuro padre). */
  protected readonly dropTargetUuid = signal<string | null>(null);
  /** `true` cuando el drop actual dejaría la categoría como raíz. */
  protected readonly rootTargeted = signal(false);

  /**
   * Padre resuelto bajo el puntero en el último `cdkDragMoved`:
   * `string` = uuid del nuevo padre, `null` = raíz, `undefined` = drop inválido (se descarta).
   *
   * Se calcula durante el movimiento y no en el drop porque para entonces el CDK ya restauró
   * el elemento arrastrado en el DOM y `elementFromPoint` devolvería el propio nodo.
   */
  private pendingParentUuid: string | null | undefined = undefined;

  protected readonly hasNodes = computed(() => this.roots().length > 0);
  protected readonly anyExpanded = computed(() => this.roots().some((node) => isAnyExpanded(node)));

  constructor() {
    this.breadcrumb.publish(() => {
      return [BREADCRUMB_HOME, { labelKey: 'nav.items.categories', link: CATEGORIES_PATHS }];
    });
  }

  ngOnInit(): void {
    this.loadTree();
  }

  protected onFilterChange(value: string): void {
    this.filterQuery.set(value);
    const query = value.trim().toLowerCase();
    if (query) {
      expandMatchingPaths(this.roots(), query);
      this.bumpTree();
    }
  }

  protected onRefresh(): void {
    this.loadTree();
  }

  protected onToggleExpandAll(): void {
    if (this.anyExpanded()) {
      collapseAll(this.roots());
    } else {
      expandAll(this.roots());
    }
    this.bumpTree();
  }

  protected onToggle(node: CategoryTreeNode): void {
    if (node.children.length === 0) {
      return;
    }

    node.expanded = !node.expanded;
    this.bumpTree();
  }

  protected onCreateRoot(): void {
    this.openFormDialog(null, null);
  }

  protected onAddChild(parent: CategoryTreeNode): void {
    this.openFormDialog(null, parent);
  }

  protected onEdit(node: CategoryTreeNode): void {
    this.openFormDialog(node, null);
  }

  protected onDelete(node: CategoryTreeNode): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('categories.confirmDelete', {
          name: node.name,
        }),
        confirmLabel: this.translate.instant('categories.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.categoriesApi.delete(node.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('categories.toasts.deleted'));
          this.removeNode(node);
        },
        error: () => {
          this.toast.error(this.translate.instant('categories.toasts.deleteError'));
        },
      });
  }

  protected onDragStarted(): void {
    this.dragging.set(true);
    this.pendingParentUuid = undefined;
    this.dropTargetUuid.set(null);
    this.rootTargeted.set(false);
  }

  /** Corre fuera de la zona de Angular (el CDK emite `moved` así); los signals igual disparan CD. */
  protected onDragMoved(event: CdkDragMove<CategoryTreeNode>): void {
    const dragged = event.source.data;
    const parentUuid = this.resolveDropParentUuid(dragged, event.pointerPosition);

    this.pendingParentUuid = parentUuid;
    this.dropTargetUuid.set(typeof parentUuid === 'string' ? parentUuid : null);
    this.rootTargeted.set(parentUuid === null);
  }

  protected onDragEnded(): void {
    this.dragging.set(false);
    this.dropTargetUuid.set(null);
    this.rootTargeted.set(false);
  }

  protected onDrop(event: CdkDragDrop<CategoryTreeNode[]>): void {
    const dragged = event.item.data as CategoryTreeNode | undefined;
    const targetParentUuid = this.pendingParentUuid;
    this.pendingParentUuid = undefined;

    if (!dragged || targetParentUuid === undefined) {
      return;
    }

    this.moveNode(dragged, targetParentUuid);
  }

  /**
   * Padre destino según el nodo que está debajo del puntero: espacio libre del árbol ⇒ raíz,
   * fuera del árbol / sobre sí mismo / dentro de su propio subárbol ⇒ drop inválido.
   */
  private resolveDropParentUuid(
    dragged: CategoryTreeNode,
    point: { x: number; y: number },
  ): string | null | undefined {
    const container = this.treeRoot()?.nativeElement;
    if (!container) {
      return undefined;
    }

    const element = document.elementFromPoint(point.x, point.y);
    if (!element || !container.contains(element)) {
      return undefined;
    }

    const host = element.closest<HTMLElement>('[data-category-uuid]');
    const targetUuid = host?.dataset['categoryUuid'] ?? null;

    if (targetUuid === null) {
      return null;
    }

    if (targetUuid === dragged.uuid || isDescendantUuid(dragged, targetUuid)) {
      return undefined;
    }

    return targetUuid;
  }

  private moveNode(dragged: CategoryTreeNode, targetParentUuid: string | null): void {
    const previousParentUuid = dragged.parentUuid;
    if (previousParentUuid === targetParentUuid) {
      return;
    }

    if (
      targetParentUuid !== null &&
      (targetParentUuid === dragged.uuid || isDescendantUuid(dragged, targetParentUuid))
    ) {
      this.toast.warning(this.translate.instant('categories.toasts.cycleError'));
      return;
    }

    const sourceList =
      previousParentUuid === null
        ? this.roots()
        : findNodeByUuid(this.roots(), previousParentUuid)?.children;
    const targetList =
      targetParentUuid === null
        ? this.roots()
        : findNodeByUuid(this.roots(), targetParentUuid)?.children;

    if (!sourceList || !targetList) {
      return;
    }

    const previousIndex = sourceList.findIndex((item) => item.uuid === dragged.uuid);
    if (previousIndex < 0) {
      return;
    }

    // El backend devuelve cada nivel ordenado por nombre: insertamos en esa posición para que
    // la UI coincida con lo que traerá el próximo getAllTree.
    transferArrayItem(
      sourceList,
      targetList,
      previousIndex,
      sortedIndexFor(targetList, dragged.name),
    );

    const liveNode = findNodeByUuid(this.roots(), dragged.uuid) ?? dragged;
    liveNode.parentUuid = targetParentUuid;

    const targetParent =
      targetParentUuid === null ? null : findNodeByUuid(this.roots(), targetParentUuid);
    if (targetParent) {
      targetParent.expanded = true;
    }

    this.bumpTree();
    this.persistParentChange(liveNode, previousParentUuid, previousIndex);
  }

  private loadTree(): void {
    const expandedUuids = collectExpandedUuids(this.roots());
    const query = this.filterQuery().trim().toLowerCase();

    this.loading.set(true);
    this.categoriesApi
      .getAllTree()
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (tree) => {
          const roots = tree.map((dto) => fromAllTreeDto(dto, null));
          restoreExpanded(roots, expandedUuids);
          if (query) {
            expandMatchingPaths(roots, query);
          }
          this.roots.set(roots);
        },
        error: () => {
          this.toast.error(this.translate.instant('categories.toasts.loadError'));
        },
      });
  }

  private bumpTree(): void {
    // Deep-clone so signal inputs on nested tree nodes see new object identities.
    // Mutating `expanded` in place + shallow `slice()` does not refresh child views.
    this.roots.update((nodes) => cloneTree(nodes));
  }

  private openFormDialog(category: CategoryTreeNode | null, parent: CategoryTreeNode | null): void {
    const dialogRef = this.dialog.open<
      CategoryFormDialogComponent,
      { category: CategoryTreeNode | null; parent: CategoryTreeNode | null },
      CategoryFormDialogResult
    >(CategoryFormDialogComponent, {
      width: '34rem',
      maxWidth: '95vw',
      autoFocus: 'first-heading',
      data: { category, parent },
    });

    dialogRef
      .afterClosed()
      .pipe(
        filter((result): result is CategoryFormDialogResult => isCategoryFormResult(result)),
        switchMap((result) =>
          this.versionConflict.saveGuarded<CategoryDto, CategoryDto>({
            uuid: result.uuid,
            version: result.version,
            save: (version) => this.categoriesApi.save(toSavePayload(result, version)),
            fetchLatest: (uuid) => this.categoriesApi.getByUuid(uuid),
            label: result.name,
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => this.onSaveOutcome(outcome, category, parent),
        error: () => {
          this.toast.error(this.translate.instant('categories.toasts.saveError'));
        },
      });
  }

  /**
   * `reloaded` es el usuario descartando lo que editó: se recarga el árbol y se reabre el
   * formulario con la categoría que hoy tiene el servidor, así retoma desde el estado real.
   */
  private onSaveOutcome(
    outcome: GuardedSaveOutcome<CategoryDto, CategoryDto>,
    category: CategoryTreeNode | null,
    parent: CategoryTreeNode | null,
  ): void {
    if (outcome.kind === 'cancelled') {
      return;
    }

    if (outcome.kind === 'reloaded') {
      this.toast.info(this.translate.instant('versionConflict.reloaded'));
      this.loadTree();
      this.openFormDialog(toTreeNode(outcome.latest), null);
      return;
    }

    this.toast.success(
      this.translate.instant(category ? 'categories.toasts.updated' : 'categories.toasts.created'),
    );
    this.applySavedCategory(outcome.value, category, parent);
  }

  private applySavedCategory(
    saved: CategoryDto,
    category: CategoryTreeNode | null,
    parent: CategoryTreeNode | null,
  ): void {
    if (category) {
      // El nodo con el que se abrió el diálogo puede no ser el que está hoy en el árbol: cada
      // `bumpTree` clona los nodos, y tras un conflicto resuelto con «Recargar» el árbol se
      // reconstruyó entero. Mutar la copia vieja mostraría el nombre anterior pese al éxito.
      const live = findNodeByUuid(this.roots(), category.uuid);
      if (!live) {
        this.loadTree();
        return;
      }

      live.name = saved.name;
      this.bumpTree();
      return;
    }

    const created = toTreeNode(saved, parent?.uuid ?? null);

    if (!parent) {
      this.roots.update((nodes) => [...nodes, created]);
      return;
    }

    parent.children = [...parent.children, created];
    parent.expanded = true;
    this.bumpTree();
  }

  /**
   * El árbol viene de `getAllTree`, que no trae los campos del Core: hay que leer la versión con
   * `GET /category/uuid` justo antes de guardar. Mandar el movimiento sin versión haría que el
   * backend rechace con 409 toda categoría que alguna vez se editó, y arrastrar un nodo no es
   * editar su contenido como para preguntarle al usuario si quiere pisar algo.
   */
  private persistParentChange(
    node: CategoryTreeNode,
    previousParentUuid: string | null,
    previousIndex: number,
  ): void {
    this.moving.set(true);

    this.categoriesApi
      .getByUuid(node.uuid)
      .pipe(
        switchMap((current) =>
          this.versionConflict.saveGuarded<CategoryDto, CategoryDto>({
            uuid: node.uuid,
            version: current.version,
            // El nombre sale de la lectura fresca y no del árbol: `save` reemplaza la categoría
            // entera, así que mandar el nombre con el que se cargó la pantalla desharía en
            // silencio el rename que otro usuario hizo mientras tanto. El padre sí sale del nodo:
            // es lo único que el arrastre quiso cambiar.
            save: (version) =>
              this.categoriesApi.save({
                uuid: node.uuid,
                name: current.name,
                parentCategory: node.parentUuid ? { uuid: node.parentUuid } : null,
                version,
              }),
            fetchLatest: (uuid) => this.categoriesApi.getByUuid(uuid),
            label: current.name,
          }),
        ),
        finalize(() => this.moving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (outcome) => {
          if (outcome.kind === 'saved') {
            this.toast.success(this.translate.instant('categories.toasts.moved'));
            return;
          }

          // Ni recargar ni cancelar guardaron el movimiento: dejar el nodo donde estaba, si no el
          // árbol muestra como hecho algo que el servidor no tiene.
          this.rollbackMove(node, previousParentUuid, previousIndex);

          if (outcome.kind === 'reloaded') {
            this.toast.info(this.translate.instant('versionConflict.reloaded'));
            this.loadTree();
          }
        },
        error: () => {
          this.rollbackMove(node, previousParentUuid, previousIndex);
          this.toast.error(this.translate.instant('categories.toasts.moveError'));
        },
      });
  }

  private rollbackMove(
    node: CategoryTreeNode,
    previousParentUuid: string | null,
    previousIndex: number,
  ): void {
    // `node` quedó obsoleto tras el bumpTree() del move: hay que revertir sobre el clon vivo,
    // si no el árbol muestra el nodo en su lugar original pero con el parentUuid nuevo.
    const liveNode = findNodeByUuid(this.roots(), node.uuid) ?? node;
    const currentParent =
      liveNode.parentUuid === null ? null : findNodeByUuid(this.roots(), liveNode.parentUuid);
    const currentList = currentParent ? currentParent.children : this.roots();
    const previousList =
      previousParentUuid === null
        ? this.roots()
        : findNodeByUuid(this.roots(), previousParentUuid)?.children;
    const currentIndex = currentList.findIndex((item) => item.uuid === liveNode.uuid);

    if (currentIndex >= 0 && previousList && currentList !== previousList) {
      transferArrayItem(
        currentList,
        previousList,
        currentIndex,
        Math.min(previousIndex, previousList.length),
      );
    }

    liveNode.parentUuid = previousParentUuid;
    this.bumpTree();
  }

  private removeNode(node: CategoryTreeNode): void {
    const removed = removeNodeByUuid(this.roots(), node.uuid);
    if (removed) {
      this.bumpTree();
    } else {
      this.loadTree();
    }
  }
}

/**
 * `categoryAttributes` se omite cuando el diálogo no pudo leer los actuales: el backend da de baja
 * los atributos que no vengan en el payload, así que mandar una lista incompleta los borraría.
 */
function toSavePayload(
  result: CategoryFormDialogResult,
  version: number | undefined,
): CategorySavePayload {
  const payload: CategorySavePayload = {
    uuid: result.uuid,
    name: result.name,
    parentCategory: result.parentUuid ? { uuid: result.parentUuid } : null,
    version,
  };

  if (result.attributes !== null) {
    payload.categoryAttributes = result.attributes;
  }

  return payload;
}

function isCategoryFormResult(value: unknown): value is CategoryFormDialogResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const result = value as CategoryFormDialogResult;
  return typeof result.name === 'string' && result.name.trim().length > 0;
}

function cloneTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.map((node) => ({
    uuid: node.uuid,
    name: node.name,
    parentUuid: node.parentUuid,
    expanded: node.expanded,
    children: cloneTree(node.children),
  }));
}

function isAnyExpanded(node: CategoryTreeNode): boolean {
  if (node.expanded) {
    return true;
  }

  return node.children.some((child) => isAnyExpanded(child));
}

function collapseAll(nodes: CategoryTreeNode[]): void {
  for (const node of nodes) {
    node.expanded = false;
    collapseAll(node.children);
  }
}

function expandAll(nodes: CategoryTreeNode[]): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      node.expanded = true;
      expandAll(node.children);
    }
  }
}

function expandMatchingPaths(nodes: CategoryTreeNode[], query: string): boolean {
  let anyMatch = false;

  for (const node of nodes) {
    const selfMatch = node.name.toLowerCase().includes(query);
    const childMatch = expandMatchingPaths(node.children, query);
    if (selfMatch || childMatch) {
      anyMatch = true;
      if (childMatch || (selfMatch && node.children.length > 0)) {
        node.expanded = true;
      }
    }
  }

  return anyMatch;
}

function collectExpandedUuids(nodes: CategoryTreeNode[]): Set<string> {
  const expanded = new Set<string>();

  const visit = (list: CategoryTreeNode[]) => {
    for (const node of list) {
      if (node.expanded) {
        expanded.add(node.uuid);
      }
      visit(node.children);
    }
  };

  visit(nodes);
  return expanded;
}

function restoreExpanded(nodes: CategoryTreeNode[], expanded: Set<string>): void {
  for (const node of nodes) {
    if (expanded.has(node.uuid) && node.children.length > 0) {
      node.expanded = true;
    }
    restoreExpanded(node.children, expanded);
  }
}

function removeNodeByUuid(nodes: CategoryTreeNode[], uuid: string): boolean {
  const index = nodes.findIndex((node) => node.uuid === uuid);
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }

  for (const node of nodes) {
    if (removeNodeByUuid(node.children, uuid)) {
      return true;
    }
  }

  return false;
}

function isDescendantUuid(node: CategoryTreeNode, uuid: string): boolean {
  for (const child of node.children) {
    if (child.uuid === uuid || isDescendantUuid(child, uuid)) {
      return true;
    }
  }

  return false;
}

/** Posición alfabética que le corresponde a `name` dentro de `list` (mismo criterio que el backend). */
function sortedIndexFor(list: CategoryTreeNode[], name: string): number {
  const index = list.findIndex(
    (item) => item.name.localeCompare(name, undefined, { sensitivity: 'base' }) > 0,
  );

  return index < 0 ? list.length : index;
}

function findNodeByUuid(nodes: CategoryTreeNode[], uuid: string): CategoryTreeNode | null {
  for (const node of nodes) {
    if (node.uuid === uuid) {
      return node;
    }

    const nested = findNodeByUuid(node.children, uuid);
    if (nested) {
      return nested;
    }
  }

  return null;
}
