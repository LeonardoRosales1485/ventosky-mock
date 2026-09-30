You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

### Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Folder Structure

Follow a vertical-slice architecture with a clear system core. Name folders by responsibility (what the code *does*), not by technical role (`services/`, `helpers/`, `managers/`).

```
src/app/
  core/                          # singleton services / cross-cutting
    http/                        # API client, error interceptor
    i18n/                        # language service, translation setup
    layout/                      # shell/layout state (e.g. sidebar)
    notifications/               # global toast service
    progress/                    # global progress indicator
    theme/                       # theme preference
  shared/                        # reusable UI building blocks (no business logic)
    components/
      settings-menu/             # theme + language menu (used by panel & auth)
      page-header/
      table-wrapper/
    pipes/
  features/                      # vertical slices / product areas
    auth/                        # login, forgot password
      pages/
        login/
          login.page.ts
          login.page.html
          login.page.css
        forgot-password/
      components/
        auth-layout/
      auth.routes.ts
    panel/                       # admin shell (sidenav + topbar)
      pages/
        panel-shell/
      components/
        sidebar/
        topbar/
        global-search/
      data-access/
      panel.routes.ts
    users/
      pages/
        users/
      components/
        user-form-dialog/
      data-access/
      users.routes.ts
    home/
      pages/
        home/
      home.routes.ts
  app.routes.ts                  # top-level routes (lazy-load features)
  app.config.ts
  app.ts
```

### Layer responsibilities

| Folder     | Responsibility              | Depends on        |
| ---------- | --------------------------- | ----------------- |
| `core/`    | System-level singletons     | nothing business  |
| `shared/`  | Reusable UI / pure helpers  | nothing business  |
| `features/`| Product / domain logic      | `core` + `shared` |

### Dependency direction

```
features  →  core
features  →  shared
shared    →  (nothing business-related)
core      →  (no feature imports)
```

Dependencies may only flow downward. Core must never import features. Shared must never contain business logic.

### Feature internal structure

Each feature under `features/<name>/` may include:

- `pages/` — smart containers used by the router
- `components/` — feature-local presentation components
- `data-access/` — feature-specific API calls
- `state/` — feature state (signals / store)
- `*.routes.ts` — lazy routes for the feature

### File & folder naming

Every page and every component lives in **its own folder** named after it, holding all of its
files (`.ts`, `.html`, `.css`, plus any page/component-local helpers such as a dialog service or
a view model). Never leave loose component files directly inside `pages/` or `components/`.

```
pages/
  login/                # folder name === page name
    login.page.ts
    login.page.html
    login.page.css
components/
  auth-layout/
    auth-layout.component.ts
    auth-layout.component.html
    auth-layout.component.css
```

- Pages use the `*.page.ts` suffix and the `SomethingPage` class name.
- Components use the `*.component.ts` suffix and the `SomethingComponent` class name.
- Folder, filename, class and selector must all agree (`login/` → `login.page.ts` → `LoginPage` →
  `app-login-page`).
- Grouping this way keeps `templateUrl` / `styleUrl` as sibling-relative paths (`./login.page.html`)
  and makes a page easy to move or delete as a unit.

Avoid generic catch-all folders (`services/`, `helpers/`, `controllers/`). Prefer location + filename that answer domain and responsibility (e.g. `core/theme/theme.service.ts`). `utils/` / `lib/` are acceptable for small pure helpers.
