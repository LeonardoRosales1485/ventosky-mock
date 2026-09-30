import { Versioned } from '../../../core/concurrency/version-conflict.model';
import { UuidNameRef } from '../../../core/http/api-refs';
import {
  PartyContactType,
  PartyDto,
  PartyRoleDto,
  PartyUserLinkRequest,
} from '../../../core/parties/party.model';

/*
 * Las fichas del directorio, tal como las devuelve cada ABM. Siguen siendo **planas**: detrás de un transportista
 * hay una identidad, un rol `EMPLOYEE`, el satélite del empleado, la fila de su especialidad y el satélite del
 * transportista, y el mapper del backend reparte entre todas. El `uuid` es siempre el del **rol**: el mismo en la
 * ficha de transportista y en la general del empleado.
 *
 * Las fechas sin hora (`dateHired`, `licenseExpiresOn`) viajan como `yyyy-MM-dd`, que es lo que devuelve y
 * acepta un `LocalDate` del backend: no pasan por `Date`, que les agregaría una zona horaria que no tienen.
 */

export interface CustomerProfileDto extends PartyRoleDto {
  priceList?: UuidNameRef | null;
}

export type SupplierProfileDto = PartyRoleDto;

/** Lo que comparten las cuatro fichas de empleado —la general y la de cada tipo—: legajo e ingreso. */
export interface EmployeeBaseDto extends PartyRoleDto {
  /** Vacío en el alta: lo asigna el sistema como correlativo de la empresa. */
  fileNumber?: string | null;
  dateHired?: string | null;
}

/** Base de las fichas por tipo. */
export interface EmployeeTypeProfileDto extends EmployeeBaseDto {
  /** La especialidad detrás de la ficha: la que revoca el borrado desde la carpeta del tipo. */
  specialtyUuid?: string | null;
}

export interface SellerProfileDto extends EmployeeTypeProfileDto {
  branch?: UuidNameRef | null;
  /** La lista con la que cotiza. No es la lista del cliente: son dos campos en dos ABM. */
  priceList?: UuidNameRef | null;
  /** Porcentaje, entre 0 y 100. */
  commissionRate?: number | null;
  salesGoalAmount?: number | null;
}

/** El comprador no tiene datos propios: su ficha es lo del empleado, con la sucursal donde trabaja. */
export interface BuyerProfileDto extends EmployeeTypeProfileDto {
  branch?: UuidNameRef | null;
}

export interface TransportistProfileDto extends EmployeeTypeProfileDto {
  branch?: UuidNameRef | null;
  licenseNumber?: string | null;
  /** Categoría de la licencia (D2, C1…). */
  licenseClass?: string | null;
  licenseExpiresOn?: string | null;
  vehiclePlate?: string | null;
  vehicleDescription?: string | null;
}

/** Cualquiera de las cinco fichas que da de alta una carpeta. */
export type DirectoryProfileDto =
  | CustomerProfileDto
  | SupplierProfileDto
  | SellerProfileDto
  | BuyerProfileDto
  | TransportistProfileDto;

/** Modalidades de contratación que acepta la ficha general del empleado. */
export const EMPLOYEE_CONTRACT_TYPES = [
  'DEPENDENT',
  'SELF_EMPLOYED',
  'INTERN',
  'TEMPORARY',
] as const;
export type EmployeeContractType = (typeof EMPLOYEE_CONTRACT_TYPES)[number];

/** Cómo se interpreta la comisión general: `NONE` va sin valor, las otras dos con. */
export const EMPLOYEE_COMMISSION_TYPES = ['NONE', 'PERCENT', 'AMOUNT'] as const;
export type EmployeeCommissionType = (typeof EMPLOYEE_COMMISSION_TYPES)[number];

/** El valor de un campo extra en un empleado: se manda el campo y el valor, y se lee además su nombre y tipo. */
export interface EmployeeAttributeValueDto {
  attributeUuid: string;
  name?: string | null;
  type?: string | null;
  value: string;
}

/** La ficha general del empleado: la carpeta «Empleados». */
export interface EmployeeProfileDto extends EmployeeBaseDto {
  branch?: UuidNameRef | null;
  /** Egreso. Vacío = vigente: los listados esconden a quien lo tiene, salvo que se pidan las bajas. */
  dateTerminated?: string | null;
  contractType?: string | null;
  /** Alta temprana ante el fisco. */
  dateRegisteredTax?: string | null;
  commissionType?: string | null;
  commissionValue?: number | null;
  /** Especialidades vigentes: `SELLER`, `BUYER`, `TRANSPORTIST`. */
  specialties?: string[] | null;
  /** Sólo en la ficha, no en el listado. */
  attributes?: EmployeeAttributeValueDto[] | null;
}

/** Una especialidad otorgada: la unión discriminada de `GET /party/employee/{uuid}/specialties`. */
export interface EmployeeSpecialtyDto extends Versioned {
  uuid: string;
  employeeUuid?: string | null;
  specialty: string;
}

/** Los roles de un usuario en una empresa, como los trae `UserDTO.userCompanyRoles`. */
export interface DirectoryUserCompanyRolesDto {
  companyUuid: string;
  companyName?: string | null;
  roles?: UuidNameRef[] | null;
}

/**
 * Un usuario de la carpeta «Con acceso al sistema». `party` es su ficha en la empresa activa —la de la empresa
 * sistema, si pertenece a ella—, y **viene vacía** para quien no es tercero de la empresa: el contador externo,
 * el soporte. Eso es un caso legítimo, no un dato faltante.
 */
export interface DirectoryUserDto extends Versioned {
  uuid: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  userCompanyRoles?: DirectoryUserCompanyRolesDto[] | null;
  party?: { uuid: string; name: string; roles?: string[] | null } | null;
}

/** Una fila de cualquier carpeta. */
export type DirectoryRow = PartyDto | DirectoryProfileDto | EmployeeProfileDto | DirectoryUserDto;

/**
 * Un rol que el bloque de acceso sugiere para un vínculo: el de sistema del vínculo, o uno personalizado que es ese
 * vínculo por sus permisos.
 */
export interface SuggestedRoleDto {
  uuid: string;
  name: string;
  /** Es el rol de sistema del vínculo: el alta lo trae elegido. */
  system: boolean;
  /**
   * Si quien carga lo puede otorgar. El que no se muestra igual, marcado: si se manda, el backend responde
   * `403 PRIVILEGE_ESCALATION`, y la pantalla lo muestra en vez de esconderlo.
   */
  grantable: boolean;
}

/** Un contacto del alta compuesta: siempre nuevo, así que va sin uuid. */
export interface OnboardContact {
  type: PartyContactType;
  value: string;
  isPrincipal: boolean;
}

/**
 * El alta compuesta de un vínculo: la ficha del tipo, sus contactos, los campos extra de un empleado y el
 * usuario, **todo o nada**. Sumarle el vínculo a alguien que ya está va con `profile.partyUuid`: la identidad se
 * reusa tal cual y lo tipeado no la pisa.
 */
export interface OnboardRequest {
  profile: Record<string, unknown>;
  contacts?: OnboardContact[];
  attributes?: { attributeUuid: string; value: string }[];
  /**
   * Obligatorio en los tres tipos de empleado; en cliente y proveedor, sin él la persona no entra. Lleva, en
   * `links`, los vínculos que sus roles piden además del de la carpeta.
   */
  user?: PartyUserLinkRequest;
}
