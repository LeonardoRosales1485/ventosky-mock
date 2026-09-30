import { version } from '../../../../package.json';

/**
 * Versión del front. La fuente única es el campo `version` de `package.json`, así que se bumpea
 * con `pnpm version <patch|minor|major>` y no hay una constante paralela que se olvide de subir.
 *
 * El import de JSON lo resuelve el bundler y sólo entra al bundle el campo usado; el resto de
 * `package.json` (dependencias incluidas) queda afuera.
 */
export const APP_VERSION: string = version;
