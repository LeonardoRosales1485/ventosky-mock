import { Component, input, output } from '@angular/core';
import {
  CdkDrag,
  CdkDragHandle,
  CdkDragMove,
  CdkDragPlaceholder,
  CdkDragPreview,
} from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { CategoryTreeNode } from '../../data-access/category.model';

@Component({
  selector: 'app-category-tree-node',
  imports: [
    CdkDrag,
    CdkDragHandle,
    CdkDragPlaceholder,
    CdkDragPreview,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    CategoryTreeNodeComponent,
  ],
  templateUrl: './category-tree-node.component.html',
  styleUrl: './category-tree-node.component.css',
})
export class CategoryTreeNodeComponent {
  readonly node = input.required<CategoryTreeNode>();
  readonly depth = input(0);
  readonly filterQuery = input('');
  /** UUID of the node the pointer is hovering over while dragging (the future parent). */
  readonly dropTargetUuid = input<string | null>(null);

  /**
   * Se pidió expandir o colapsar este nodo. No se llama `toggle` porque ése es el nombre de un
   * evento nativo del DOM —el del `<details>`— y el padre no podría distinguir uno del otro.
   */
  readonly toggled = output<CategoryTreeNode>();
  readonly addChild = output<CategoryTreeNode>();
  readonly edit = output<CategoryTreeNode>();
  readonly remove = output<CategoryTreeNode>();
  readonly dragStarted = output<void>();
  readonly dragMoved = output<CdkDragMove<CategoryTreeNode>>();
  readonly dragEnded = output<void>();

  protected isDropTarget(): boolean {
    return this.dropTargetUuid() === this.node().uuid;
  }

  protected showExpand(): boolean {
    return this.node().children.length > 0;
  }

  protected matchesFilter(node: CategoryTreeNode): boolean {
    const query = this.filterQuery().trim().toLowerCase();
    if (!query) {
      return true;
    }

    if (node.name.toLowerCase().includes(query)) {
      return true;
    }

    return node.children.some((child) => this.matchesFilter(child));
  }

  protected onToggle(event: Event): void {
    event.stopPropagation();
    this.toggled.emit(this.node());
  }

  protected onAddChild(event: Event): void {
    event.stopPropagation();
    this.addChild.emit(this.node());
  }

  protected onEdit(event: Event): void {
    event.stopPropagation();
    this.edit.emit(this.node());
  }

  protected onRemove(event: Event): void {
    event.stopPropagation();
    this.remove.emit(this.node());
  }
}
