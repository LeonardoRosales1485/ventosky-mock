import { PanelSectionId } from './panel-areas';

export interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
  /** Extra keywords matched by global search (language-agnostic). */
  tags?: readonly string[];
}

export interface NavSection {
  /** Clave estable del grupo: el label puede repetirse o no mostrarse, el id no. */
  id: PanelSectionId;
  labelKey: string;
  /** El grupo se lista sin encabezado, aunque su label siga ubicándolo en el buscador. */
  hidden?: boolean;
  items: readonly NavItem[];
}

export interface NavSearchResult {
  item: NavItem;
  sectionLabelKey: string;
}
