# MatAdmin

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.1.2.

## Package manager

This project uses **pnpm**, and only pnpm. The deploy image (`deploy/plantillas/angular-21-node-22/Dockerfile`)
refuses to build if it finds a `package-lock.json` or a `yarn.lock` in the root, so installing with
npm does not just diverge locally — it breaks the deploy.

The version is pinned in `package.json` under `packageManager`, so the way to get the right one is
Corepack rather than a global install:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
```

`pnpm-workspace.yaml` lists the dependencies allowed to run install scripts. pnpm blocks them by
default, so a package that needs one and is missing from that list installs quietly and fails later,
at build time.

## Versionado

La versión del front vive en un solo lugar: el campo `version` de `package.json`. Se bumpea con

```bash
pnpm version patch   # o minor / major
```

`core/version/app-version.ts` la importa desde ahí (`APP_VERSION`), así que no hay una constante
paralela que actualizar. El pie de las pantallas de autenticación
(`shared/components/version-info/`) la muestra junto a la del backend, que sale de
`GET /api/actuator/info` (`core/version/backend-version.service.ts`). Si el backend no responde,
sólo se muestra la del front.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
