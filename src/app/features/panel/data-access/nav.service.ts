import { Service, computed, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/auth/auth.service';
import { NavItem, NavSearchResult, NavSection } from './nav.model';
import {
  PANEL_AREAS,
  PANEL_SECTIONS,
  canAccessArea,
  canAccessPage,
  panelAreaRoute,
  panelPageRoute,
} from './panel-areas';

@Service()
export class NavService {
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);

  /**
   * Las secciones del sidebar, armadas desde el manifiesto y acotadas a lo que el usuario puede
   * abrir. Una sección que se queda sin ítems no se lista: sería un título sin nada debajo.
   *
   * Un área `hidden` tampoco aparece: existe por sus pantallas internas —a las que se entra desde
   * otra área— y su raíz no es un destino. Como el buscador se arma sobre esto, desaparece de los
   * dos lados a la vez, que es lo que corresponde; sus {@link PanelArea.pages} se indexan aparte.
   */
  readonly sections = computed<readonly NavSection[]>(() =>
    PANEL_SECTIONS.map((section) => ({
      id: section.id,
      labelKey: section.labelKey,
      hidden: section.hidden,
      items: PANEL_AREAS.filter(
        (area) => area.section === section.id && !area.hidden && canAccessArea(area, this.auth),
      ).map((area) => toNavItem(area.labelKey, area.icon, panelAreaRoute(area), area.tags)),
    })).filter((section) => section.items.length > 0),
  );

  /**
   * Además de las áreas del menú, el buscador encuentra las pantallas internas de cada una
   * —"Nuevo producto"— que no tienen lugar en el sidebar. Una pantalla que exige un parámetro no se
   * declara en el manifiesto, así que nunca aparece acá.
   */
  search(query: string): NavSearchResult[] {
    // Se matchea palabra por palabra y todas tienen que aparecer en algún lado: "nuevo producto"
    // encuentra el alta aunque "nuevo" venga de un tag y "producto" del nombre del área, y sigue
    // encontrándola escrita al revés.
    const tokens = this.normalize(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return this.allItems();
    }

    return this.allItems().filter(({ item, sectionLabelKey }) => {
      const haystack = [
        this.translate.instant(item.labelKey),
        this.translate.instant(sectionLabelKey),
        ...(item.tags ?? []),
      ]
        .map((value) => this.normalize(value))
        .join(' ');

      return tokens.every((token) => haystack.includes(token));
    });
  }

  /** Primero las áreas, en el orden del menú; después sus pantallas internas. */
  private allItems(): NavSearchResult[] {
    const areas = this.sections().flatMap((section) =>
      section.items.map((item) => ({ item, sectionLabelKey: section.labelKey })),
    );

    const pages = PANEL_AREAS.flatMap((area) =>
      (area.pages ?? [])
        .filter((page) => canAccessPage(area, page, this.auth))
        .map((page) => ({
          item: toNavItem(
            page.labelKey,
            page.icon ?? area.icon,
            panelPageRoute(area, page),
            page.tags,
          ),
          // La pantalla se ubica por su área ("Nuevo producto · Productos"), que dice bastante más
          // que el nombre de la sección.
          sectionLabelKey: area.labelKey,
        })),
    );

    return [...areas, ...pages];
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  }
}

function toNavItem(
  labelKey: string,
  icon: string,
  route: string,
  tags: readonly string[] | undefined,
): NavItem {
  return { labelKey, icon, route, tags };
}
