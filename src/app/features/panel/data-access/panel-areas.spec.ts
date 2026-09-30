import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { Permissions } from '../../../core/auth/permissions';
import { NavService } from './nav.service';
import { PANEL_AREAS, PANEL_SECTIONS } from './panel-areas';

describe('PANEL_AREAS', () => {
  /**
   * El manifiesto declara rutas que el router carga por separado, así que lo que puede romperse en
   * silencio es que una pantalla declarada no exista (o pase a exigir un parámetro). Acá se
   * resuelven los `loadChildren` de verdad —en un test no hay presupuesto de bundle que cuidar— y
   * se comparan contra lo declarado.
   *
   * **Por qué este caso lleva timeout propio.** Resolver los `loadChildren` importa, una por una, las
   * rutas de cada feature, y con ellas el árbol de componentes que cuelga de cada pantalla: es el
   * único test que carga la aplicación entera. Medido acá tarda ~11 s para 21 áreas —ninguna se
   * destaca; es la suma— contra los 5 s que vitest da por defecto, así que fallaba por presupuesto y
   * no por un import roto. El número crece con cada feature nueva, de a un área por vez.
   *
   * Los 30 s son margen sobre esa medición, no una estimación: si algún día se agota, el problema no
   * va a ser este `timeout` sino que alguna ruta dejó de resolver, y ahí conviene mirar **cuál** en
   * vez de volver a subirlo.
   */
  it('only declares pages that exist as real routes and need no parameter', async () => {
    for (const area of PANEL_AREAS) {
      const routes = await area.loadChildren();
      const paths = routes.map((route: Route) => route.path);

      for (const page of area.pages ?? []) {
        expect(paths, `${area.path} › ${page.path}`).toContain(page.path);
        expect(page.path).not.toMatch(/[:*]/);
      }
    }
  }, 30_000);

  it('reaches every area from a single path under /panel', () => {
    for (const area of PANEL_AREAS) {
      expect(area.path).not.toMatch(/^\//);
      expect(area.navPath ?? area.path).toContain(area.path);
    }
  });

  /**
   * Una sección declarada en un área pero ausente de `PANEL_SECTIONS` no rompe nada: el área
   * simplemente desaparece del sidebar, que es justo el silencio que hay que evitar.
   */
  it('places every area in a declared section', () => {
    const declared = new Set(PANEL_SECTIONS.map((section) => section.id));

    for (const area of PANEL_AREAS) {
      expect(declared, area.path).toContain(area.section);
    }

    // Y al revés: una sección sin áreas es un título que nunca se dibuja.
    for (const section of PANEL_SECTIONS) {
      expect(
        PANEL_AREAS.some((area) => area.section === section.id),
        section.id,
      ).toBe(true);
    }
  });

  /**
   * Un área oculta no tiene ítem que la ofrezca: si además no declarara pantallas internas, sería
   * una ruta a la que no se llega desde ningún lado. Y su raíz tampoco dibuja nada —se entra por
   * otra área—, así que redirige en vez de montar un componente.
   */
  it('reaches a hidden area through its inner screens', async () => {
    for (const area of PANEL_AREAS.filter((candidate) => candidate.hidden)) {
      expect(area.pages ?? [], area.path).not.toHaveLength(0);

      const root = (await area.loadChildren()).find((route: Route) => route.path === '');
      expect(root?.component, area.path).toBeUndefined();
      expect(root?.redirectTo, area.path).toBeTruthy();
    }
  }, 30_000);

  it('hides only the section that holds a single unlabelled area', () => {
    const hidden = PANEL_SECTIONS.filter((section) => section.hidden);

    expect(hidden.map((section) => section.id)).toEqual(['general']);
    // Aunque no se dibuje, el label sigue haciendo falta: el buscador ubica ahí sus resultados.
    expect(hidden[0].labelKey).toBeTruthy();
  });
});

describe('NavService', () => {
  let permissions: Set<string>;

  const nav = (): NavService => TestBed.inject(NavService);

  beforeEach(() => {
    permissions = new Set<string>(Object.values(Permissions));

    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        NavService,
        {
          provide: AuthService,
          useValue: { hasPermission: (permission: string) => permissions.has(permission) },
        },
      ],
    });
  });

  it('lists every area the user can open', () => {
    const routes = nav()
      .sections()
      .flatMap((section) => section.items.map((item) => item.route));

    expect(routes).toContain('/panel/products');
    expect(routes).toContain('/panel/home');
  });

  it('hides an area whose permission is missing', () => {
    permissions.delete(Permissions.productBranchAssign);

    const routes = nav()
      .sections()
      .flatMap((section) => section.items.map((item) => item.route));

    expect(routes).not.toContain('/panel/products');
    // El resto del menú sigue en pie.
    expect(routes).toContain('/panel/brands');
  });

  /**
   * «Mis compras» es la versión acotada de «Ventas» y «Catálogo» la de «Productos»: quien tiene la pantalla
   * completa no encuentra la acotada, aunque el administrador tenga también el permiso que la abre.
   */
  it('hides an area superseded by the permission of its full screen', () => {
    const routesOf = () =>
      nav()
        .sections()
        .flatMap((section) => section.items.map((item) => item.route));

    expect(routesOf()).toContain('/panel/sales');
    expect(routesOf()).not.toContain('/panel/my-purchases');
    expect(routesOf()).not.toContain('/panel/catalog');

    permissions = new Set<string>([Permissions.orderViewOwn, Permissions.productView]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        NavService,
        {
          provide: AuthService,
          useValue: { hasPermission: (permission: string) => permissions.has(permission) },
        },
      ],
    });

    expect(routesOf()).toContain('/panel/my-purchases');
    expect(routesOf()).toContain('/panel/catalog');
    expect(routesOf()).not.toContain('/panel/sales');
  });

  /**
   * El directorio junta carpetas de cuatro familias —clientes, proveedores, empleados y usuarios— y se abre
   * con cualquiera de sus permisos de lectura: quien sólo ve usuarios encuentra el área, y adentro, sólo su
   * carpeta.
   */
  it('opens an area with any one of its permissions', () => {
    permissions = new Set<string>([Permissions.userView]);

    const routes = nav()
      .sections()
      .flatMap((section) => section.items.map((item) => item.route));

    expect(routes).toContain('/panel/directory');
  });

  it('hides an area that asks for any of several permissions when none is there', () => {
    permissions = new Set<string>([Permissions.brandView]);

    const routes = nav()
      .sections()
      .flatMap((section) => section.items.map((item) => item.route));

    expect(routes).not.toContain('/panel/directory');
    expect(routes).toContain('/panel/brands');
  });

  /**
   * Los modelos ya no tienen listado propio —sus filas viven en el catálogo de productos—, así que
   * su área no se ofrece ni en el menú ni en el buscador. Lo que sí se sigue encontrando es la
   * matriz, que es la pantalla que quedó: mientras el área esté encendida.
   */
  it('never offers a hidden area, only its inner screens', () => {
    const routes = nav()
      .search('')
      .map((result) => result.item.route);

    for (const area of PANEL_AREAS.filter((candidate) => candidate.hidden)) {
      expect(routes).not.toContain(`/panel/${area.path}`);

      for (const page of area.pages ?? []) {
        const route = `/panel/${area.path}/${page.path}`;
        if (area.enabled === false) {
          expect(routes).not.toContain(route);
        } else {
          expect(routes).toContain(route);
        }
      }
    }
  });

  /** El interruptor de `environment.features` apaga el área entera, permisos aparte. */
  it('offers nothing of an area switched off by a feature flag', () => {
    const switchedOff = PANEL_AREAS.filter((area) => area.enabled === false);
    const routes = [
      ...nav()
        .sections()
        .flatMap((section) => section.items.map((item) => item.route)),
      ...nav()
        .search('')
        .map((result) => result.item.route),
    ];

    for (const area of switchedOff) {
      expect(
        routes.filter((route) => route.startsWith(`/panel/${area.path}`)),
        area.path,
      ).toEqual([]);
    }
  });

  /**
   * Usuarios y roles se gatean como cualquier otra área desde que el backend dejó de reservarlos al
   * SysAdmin: sin `user.view` el ítem no se ofrece.
   */
  it('hides the users area without user.view', () => {
    permissions.delete(Permissions.userView);

    const routes = nav()
      .sections()
      .flatMap((section) => section.items.map((item) => item.route));

    expect(routes).not.toContain('/panel/users');
    // Roles pide su propio permiso: quien no administra usuarios puede seguir viendo los roles.
    expect(routes).toContain('/panel/roles');
  });

  it('hides the roles area without role.view', () => {
    permissions.delete(Permissions.roleView);

    const routes = nav()
      .sections()
      .flatMap((section) => section.items.map((item) => item.route));

    expect(routes).not.toContain('/panel/roles');
    expect(routes).toContain('/panel/users');
  });

  it('finds a screen that is not in the sidebar', () => {
    const results = nav().search('nuevo producto');

    expect(results.map((result) => result.item.route)).toContain('/panel/products/new');
  });

  it('places an inner screen under its own area', () => {
    const page = nav()
      .search('alta')
      .find((result) => result.item.route === '/panel/products/new');

    expect(page?.sectionLabelKey).toBe('nav.items.products');
  });

  it('drops an inner screen when its own permission is missing', () => {
    permissions.delete(Permissions.productCreate);

    const routes = nav()
      .search('')
      .map((result) => result.item.route);

    expect(routes).not.toContain('/panel/products/new');
    // El área sigue disponible: lo que se pierde es el alta, no el listado.
    expect(routes).toContain('/panel/products');
  });

  it('never offers a route that needs a parameter', () => {
    const routes = nav()
      .search('')
      .map((result) => result.item.route);

    expect(routes.some((route) => route.includes(':'))).toBe(false);
  });
});
