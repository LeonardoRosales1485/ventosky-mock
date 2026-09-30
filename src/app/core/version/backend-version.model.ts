/**
 * Respuesta de `GET /api/actuator/info` (`VersionInfoContributor` del backend).
 *
 * Todo es opcional menos `version`: los campos de fecha se agregaron después (ver
 * `blue-productos/.../changelog/modificaciones-del-core.md`, 2026-08-18) y un backend viejo
 * responde sin ellos.
 */
export interface BackendInfoDto {
  /** Versión de la aplicación (`Version.VERSION`). */
  version: string;
  /** Fecha en que se bumpeó `version`, `YYYY-MM-DD`. */
  date?: string;
  /** Versión del framework Core (`CoreVersion.CORE_VERSION`). */
  coreVersion?: string;
  /** Fecha en que se bumpeó `coreVersion`, `YYYY-MM-DD`. */
  coreDate?: string;
}
