import { DestroyRef, Service, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { BREADCRUMB_ROUTE_DATA_KEY, BreadcrumbItem, BreadcrumbRouteData } from './breadcrumb.model';

/**
 * The breadcrumb of the screen on display, and the only thing the panel shell's
 * bar reads.
 *
 * A screen is configured **declaratively**, on its route:
 *
 * ```ts
 * data: { breadcrumb: [BREADCRUMB_HOME, { labelKey: 'nav.items.applications' }] }
 * ```
 *
 * and the trail is every declaration along the activated route chain, so a
 * child route only names what it adds. A screen that declares nothing has no
 * breadcrumb — {@link visible} is false and the shell renders no bar at all,
 * rather than a trail with one entry that leads nowhere.
 *
 * A detail screen's last crumb is the record's own name, which is not known
 * until it is loaded, so it is published from the component instead —
 * {@link publish}. The route still declares the static part, and that is what
 * shows while the record is in flight.
 *
 * Labels stay unresolved here: a crumb carries a translation key and the bar
 * translates it, so the trail follows a language change without being rebuilt.
 */
@Service()
export class BreadcrumbService {
  private readonly router = inject(Router);

  /** What the activated routes declare. Recomputed on every navigation. */
  private readonly routeTrail = signal<readonly BreadcrumbItem[]>([]);

  /** What the screen on display publishes for itself, while it is alive. */
  private readonly publishedTrail = signal<Signal<readonly BreadcrumbItem[] | null> | null>(null);

  /** The trail to render: what the screen published, else what its routes declare. */
  readonly items = computed<readonly BreadcrumbItem[]>(
    () => this.publishedTrail()?.() ?? this.routeTrail(),
  );

  readonly visible = computed(() => this.items().length > 0);

  constructor() {
    this.routeTrail.set(collectTrail(this.router.routerState.snapshot.root));

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.routeTrail.set(collectTrail(this.router.routerState.snapshot.root));
      }
    });
  }

  /**
   * Publishes the trail of the calling screen for as long as it lives.
   *
   * `source` is read as a signal, so a detail screen can hand over a
   * `computed` off its store and the record's name lands in the trail as soon
   * as it arrives; returning `null` falls back to what the routes declare,
   * which is what should show while the record loads.
   *
   * **Call it from an injection context** — a field initializer or the
   * constructor — because the trail is dropped when the caller is destroyed.
   * Tying it to the component rather than to a navigation is what keeps a
   * detail screen's name in place while its own tabs are navigated, and what
   * keeps it from leaking into the screen that follows.
   */
  publish(source: () => readonly BreadcrumbItem[] | null): void {
    const destroyRef = inject(DestroyRef);
    const trail = computed(source);

    this.publishedTrail.set(trail);

    destroyRef.onDestroy(() => {
      // Only if nothing published over it in the meantime: a screen is
      // destroyed after its successor is created in some navigations.
      if (this.publishedTrail() === trail) {
        this.publishedTrail.set(null);
      }
    });
  }
}

/**
 * Walks the activated chain, appending what each route declares.
 *
 * Read off `routeConfig.data` rather than the snapshot's resolved `data`: the
 * router hands a parent's data down to a pathless or component-less child, and
 * an inherited declaration would put the same crumb in the trail twice.
 */
function collectTrail(root: ActivatedRouteSnapshot): readonly BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [];

  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    const declared = route.routeConfig?.data?.[BREADCRUMB_ROUTE_DATA_KEY] as
      BreadcrumbRouteData | undefined;

    if (!declared) {
      continue;
    }

    const items: readonly BreadcrumbItem[] = Array.isArray(declared) ? declared : [declared];
    trail.push(...items);
  }

  return trail;
}
