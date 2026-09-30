/**
 * One step of the trail the panel shell renders under the topbar.
 *
 * A crumb names itself either through `labelKey` — the usual case, since a
 * screen's name already exists as a `nav.items.*` translation key — or through
 * `label`, text that is already resolved and must not be translated, which is
 * what a detail screen uses for the record it is about. `link` is what makes a
 * crumb navigable; the last crumb is the screen being looked at and renders as
 * plain text whether it carries a link or not.
 */
export interface BreadcrumbItem {
  readonly labelKey?: string;
  readonly label?: string;
  readonly link?: string;
}

/**
 * What a route declares under `data.breadcrumb`: the crumb it contributes, or
 * the several it contributes at once. A screen's trail is every declaration
 * along its activated route chain, in order — so a child route only spells out
 * what it adds to its parent's.
 */
export type BreadcrumbRouteData = BreadcrumbItem | readonly BreadcrumbItem[];

/** The `Route.data` key {@link BreadcrumbService} reads. */
export const BREADCRUMB_ROUTE_DATA_KEY = 'breadcrumb';

/**
 * The root crumb a configured screen starts from.
 *
 * Deliberately **not** contributed by the panel route: a screen that declares
 * nothing shows no breadcrumb at all, and a lone "Home" would be a trail that
 * traces nothing. The home screen itself is the root, so it declares none.
 */
export const BREADCRUMB_HOME: BreadcrumbItem = {
  labelKey: 'nav.items.home',
  link: '/panel/home',
};
