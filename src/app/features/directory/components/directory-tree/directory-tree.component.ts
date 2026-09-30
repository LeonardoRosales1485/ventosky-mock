import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DirectoryFolder, DirectoryFolderId } from '../../data-access/directory-folders';
import { directoryFolderRoute } from '../../directory.paths';

/**
 * El árbol de carpetas del directorio. Cada carpeta es un lugar al que se navega —un link con su ruta—, y el
 * número es cuántas filas tiene con los filtros por defecto: el mismo total que muestra su listado al entrar.
 *
 * Sólo lista las carpetas que el usuario puede abrir: quien tiene permiso de clientes ve la de clientes y nada
 * más, ni siquiera «Todos».
 */
@Component({
  selector: 'app-directory-tree',
  imports: [RouterLink, TranslatePipe],
  template: `
    <ul class="tree">
      @for (folder of folders(); track folder.id) {
        <li class="tree__item" [class.tree__item--child]="folder.child">
          <a
            class="tree__link"
            [class.tree__link--active]="folder.id === active()"
            [routerLink]="routeOf(folder.id)"
            [attr.aria-current]="folder.id === active() ? 'page' : null"
          >
            <span class="tree__label">{{
              'directory.folders.' + folder.id + '.label' | translate
            }}</span>
            @let count = counts()[folder.id];
            @if (count !== undefined) {
              <span class="tree__count">{{ count }}</span>
            }
          </a>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }

    .tree {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .tree__item--child .tree__link {
      padding-left: 1.75rem;
    }

    .tree__item--child .tree__link::before {
      content: '└';
      position: absolute;
      left: 0.75rem;
      color: var(--mat-sys-outline);
    }

    .tree__link {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: 0.5rem;
      color: var(--mat-sys-on-surface);
      font-size: 0.875rem;
      text-decoration: none;
    }

    .tree__link:hover {
      background: var(--mat-sys-surface-container-high);
    }

    .tree__link:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: -2px;
    }

    .tree__link--active {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      font-weight: 600;
      box-shadow: inset 3px 0 0 var(--mat-sys-primary);
    }

    .tree__label {
      flex: 1;
      min-width: 0;
    }

    .tree__count {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
    }

    .tree__link--active .tree__count {
      color: inherit;
    }
  `,
})
export class DirectoryTreeComponent {
  readonly folders = input.required<readonly DirectoryFolder[]>();
  readonly active = input.required<DirectoryFolderId>();
  readonly counts = input<Partial<Record<DirectoryFolderId, number>>>({});

  protected readonly routeOf = directoryFolderRoute;
}
