import { Versioned } from '../concurrency/version-conflict.model';
import type { DirectoryLinkProfileRequest } from './directory-links';

/**
 * El maestro unificado, del lado del front.
 *
 * Un cliente y un proveedor no son dos entidades: son **una persona —física o jurídica— en dos
 * roles**. El backend lo guarda en tres tablas (`parties` para la identidad, `party_roles` para el
 * vínculo y un satélite por rol), pero la ficha que viaja sigue siendo **plana**: el mapper reparte
 * y la pantalla no paga la normalización.
 *
 * Vive en `core/` y no en un feature porque lo comparten el directorio y las pantallas de venta y compra:
 * duplicarlo llevaría a que una se quede atrás cuando el contrato cambie.
 */

/** Tipos de documento que admite el maestro. Pasaporte y demás los define la matriz fiscal. */
export const PARTY_DOC_TYPES = ['CUIT', 'CUIL', 'DNI'] as const;
export type PartyDocType = (typeof PARTY_DOC_TYPES)[number];

/**
 * Los documentos de una **persona**: los que ofrecen las fichas de empleado. El CUIT es de quien factura,
 * y se carga desde la ficha de cliente o de proveedor, que son las que preguntan lo fiscal.
 */
export const PERSON_DOC_TYPES = ['CUIL', 'DNI'] as const satisfies readonly PartyDocType[];

/** Roles del tercero. El de empleado se detalla en especialidades: ver `directory-links.ts`. */
export const PARTY_ROLES = ['CUSTOMER', 'SUPPLIER', 'EMPLOYEE'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

/** Canales de contacto. El principal es **por tipo**, no uno solo por tercero. */
export const PARTY_CONTACT_TYPES = ['EMAIL', 'PHONE', 'WHATSAPP'] as const;
export type PartyContactType = (typeof PARTY_CONTACT_TYPES)[number];

/** Contacto de la identidad: el mail de administración es el mismo nos compre o nos venda. */
export interface PartyContactDto extends Versioned {
  uuid: string;
  partyUuid?: string | null;
  type: PartyContactType;
  value: string;
  /** «Administración», «Cobranzas», «Depósito». Texto libre. */
  label?: string | null;
  isPrincipal?: boolean | null;
}

export interface PartyContactSavePayload {
  uuid?: string;
  partyUuid: string;
  type: PartyContactType;
  value: string;
  label?: string | null;
  isPrincipal?: boolean;
  version?: number;
}

/** Un rol del tercero, tal como lo lista su ficha de identidad. */
export interface PartyRoleSummaryDto {
  uuid: string;
  role: PartyRole;
  status?: number;
}

/**
 * Ficha de identidad con sus roles. Es lo que devuelve `POST /party/search`, y lo que le permite al
 * alta decir «ya está cargado como proveedor» en vez de un 409 sobre una ficha que el usuario no
 * puede ver desde donde está.
 */
export interface PartyDto extends Versioned {
  uuid: string;
  name: string;
  docType?: PartyDocType | null;
  docNumber?: string | null;
  taxCondition?: string | null;
  roles?: PartyRoleSummaryDto[] | null;
  contacts?: PartyContactDto[] | null;
  /** El usuario con el que la persona entra al sistema, si entra. Sólo de lectura: ver {@link PartyUserLinkRequest}. */
  userUuid?: string | null;
  username?: string | null;
}

/** Lo que comparten las fichas de rol: la identidad, embebida y plana. */
export interface PartyRoleDto extends Versioned {
  uuid: string;
  /** Identidad detrás del rol. Dos roles del mismo tercero comparten este uuid. */
  partyUuid?: string | null;
  name: string;
  docType?: PartyDocType | null;
  docNumber?: string | null;
  taxCondition?: string | null;
  role?: PartyRole | null;
  contacts?: PartyContactDto[] | null;
  /**
   * El usuario de la identidad. **Sólo de lectura**: si viajara en el guardado de la ficha, editar el
   * nombre desde la de proveedor le borraría el login al empleado. Se escribe con
   * `POST /party/{uuid}/user` o con el alta compuesta.
   */
  userUuid?: string | null;
  username?: string | null;
}

/**
 * El vínculo de una ficha con su usuario: el cuerpo de `POST /party/{uuid}/user` y el bloque `user` del
 * alta compuesta.
 *
 * O un usuario que ya existe (`userUuid`), o uno nuevo (`username` y `password`). En los dos casos,
 * `roleUuids` son los roles que se le **agregan** en la empresa activa: nunca se le quita uno.
 *
 * `links` son los vínculos que esos roles la hacen ser y la ficha todavía no tiene, con sus datos: el cliente con
 * un rol de reparto es transportista. Sin ellos, el backend rechaza el pedido con `PARTY_LINKS_MISSING`.
 */
export type PartyUserLinkRequest =
  | { userUuid: string; roleUuids: string[]; links?: DirectoryLinkProfileRequest[] }
  | {
      username: string;
      password: string;
      email?: string | null;
      roleUuids: string[];
      links?: DirectoryLinkProfileRequest[];
    };

export const PARTY_NAME_MAX_LENGTH = 255;
export const PARTY_DOC_NUMBER_MAX_LENGTH = 50;
export const PARTY_TAX_CONDITION_MAX_LENGTH = 50;
export const PARTY_CONTACT_VALUE_MAX_LENGTH = 255;
export const PARTY_CONTACT_LABEL_MAX_LENGTH = 100;

/** Dígitos con guiones opcionales: cubre `30-12345678-9` y `30123456789`. */
export const PARTY_DOC_NUMBER_PATTERN = /^[\d-]{7,20}$/;

/**
 * Documento legible: `CUIT 30-12345678-9`, o `—` cuando el tercero se cargó sin documento.
 *
 * Toma el tipo como `string` y no como {@link PartyDocType} porque también la usan los DTO de las
 * pantallas de venta y compra, que reflejan lo que el backend manda sin estrechar el tipo.
 */
export function formatDocument(party: {
  docType?: string | null;
  docNumber?: string | null;
}): string {
  if (!party.docNumber) {
    return '—';
  }
  return party.docType ? `${party.docType} ${party.docNumber}` : party.docNumber;
}

/** El rol pedido, si el tercero ya lo tiene activo. */
export function roleOf(party: PartyDto, role: PartyRole): PartyRoleSummaryDto | null {
  return (party.roles ?? []).find((candidate) => candidate.role === role) ?? null;
}
