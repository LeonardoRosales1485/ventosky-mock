import { PartyRole } from './party.model';

/**
 * Los vínculos del directorio: qué es una persona para la empresa.
 *
 * Son los dos roles del maestro —cliente y proveedor— y las tres especialidades del empleado. `EMPLOYEE`
 * a secas no es un vínculo: un empleado sin especialidad no se da de alta, porque cada tipo pide campos
 * propios. Son constantes de código y no un catálogo que la empresa amplía: cada uno tiene lógica detrás
 * —el vendedor, una comisión por venta—, y una fila que el usuario creara prometería esa lógica sin tenerla.
 *
 * Lo que una persona es sale de lo que puede hacer: los permisos de sus roles detectan sus vínculos, y el
 * backend es quien lo decide. Vive en `core/` porque lo nombran dos pantallas: el directorio, que da de alta
 * cada vínculo, y la de roles, que avisa qué vínculos detectan los permisos elegidos. Las etiquetas están en
 * `directoryLinks.*` de los archivos de idioma.
 */
export const DIRECTORY_LINKS = ['CUSTOMER', 'SUPPLIER', 'SELLER', 'BUYER', 'TRANSPORTIST'] as const;
export type DirectoryLink = (typeof DIRECTORY_LINKS)[number];

/** Las especialidades del empleado, en el orden en que las lista el directorio. */
export const EMPLOYEE_SPECIALTIES = ['SELLER', 'BUYER', 'TRANSPORTIST'] as const;
export type EmployeeSpecialty = (typeof EMPLOYEE_SPECIALTIES)[number];

export function isDirectoryLink(value: string): value is DirectoryLink {
  return (DIRECTORY_LINKS as readonly string[]).includes(value);
}

export function isEmployeeSpecialty(value: string): value is EmployeeSpecialty {
  return (EMPLOYEE_SPECIALTIES as readonly string[]).includes(value);
}

/** El rol del maestro detrás de un vínculo: las tres especialidades cuelgan del mismo `EMPLOYEE`. */
export function partyRoleOfLink(link: DirectoryLink): PartyRole {
  return isEmployeeSpecialty(link) ? 'EMPLOYEE' : link;
}

/**
 * El pedido de `POST /party/directory-links/detect`. Los permisos salen de los roles, de los permisos sueltos
 * —los de un rol que todavía no se guardó— y de los roles que `userUuid` ya tiene en la empresa: se suman, igual
 * que al guardar, que le agrega roles al usuario y nunca le quita.
 */
export interface DirectoryLinkDetectRequest {
  roleUuids?: string[];
  permissionUuids?: string[];
  /** La ficha a la que se le dan los roles, si ya existe: cada vínculo dice si ya lo tiene. */
  partyUuid?: string | null;
  /** El usuario que ya existe y al que se le suman los roles. */
  userUuid?: string | null;
}

/** Un vínculo que detectaron los permisos. */
export interface DetectedDirectoryLinkDto {
  /** Un código de {@link DIRECTORY_LINKS}. Viaja como texto: uno que el front no conoce se ignora. */
  link: string;
  /** Los permisos que lo hacen ese vínculo: los que exige su firma. */
  because: string[];
  /** La ficha del pedido ya lo tiene. `false` si no vino ficha. */
  alreadyHas: boolean;
}

/**
 * Un vínculo que se le suma a la ficha junto con su acceso, porque sus roles la hacen serlo: el código y los datos
 * de su ABM, planos, como los pide su alta.
 */
export interface DirectoryLinkProfileRequest {
  link: DirectoryLink;
  profile: Record<string, unknown>;
}
