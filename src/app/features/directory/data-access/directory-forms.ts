import { AttributeValueType } from '../../../core/attributes/attribute-value-type';
import {
  DIRECTORY_LINKS,
  DetectedDirectoryLinkDto,
  DirectoryLink,
  DirectoryLinkProfileRequest,
  isEmployeeSpecialty,
} from '../../../core/parties/directory-links';
import {
  PARTY_DOC_TYPES,
  PERSON_DOC_TYPES,
  PartyDocType,
  PartyDto,
  PartyUserLinkRequest,
  roleOf,
} from '../../../core/parties/party.model';
import {
  CustomerProfileDto,
  DirectoryProfileDto,
  EmployeeTypeProfileDto,
  OnboardRequest,
  SellerProfileDto,
  SuggestedRoleDto,
  TransportistProfileDto,
} from './directory.model';

/**
 * El formulario de un vínculo, declarado una vez: qué identidad pide y si el acceso es opcional u obligatorio.
 * La pantalla se arma desde acá, no con un `if` por tipo.
 */
export interface DirectoryFormDefinition {
  link: DirectoryLink;
  /**
   * `fiscal` pide razón social, cualquier documento y la condición frente al IVA: es de quien le
   * facturamos o nos factura. `person` pide nombre y apellido con CUIL o DNI, y nada fiscal.
   */
  identity: 'fiscal' | 'person';
  /**
   * `optional`: un interruptor apagado, que apagado no pide nada. `required`: el empleado no se da de
   * alta sin usuario, porque su trabajo queda firmado a su nombre.
   */
  access: 'optional' | 'required';
}

export const DIRECTORY_FORMS: Readonly<Record<DirectoryLink, DirectoryFormDefinition>> = {
  CUSTOMER: {
    link: 'CUSTOMER',
    identity: 'fiscal',
    access: 'optional',
  },
  SUPPLIER: {
    link: 'SUPPLIER',
    identity: 'fiscal',
    access: 'optional',
  },
  SELLER: {
    link: 'SELLER',
    identity: 'person',
    access: 'required',
  },
  BUYER: {
    link: 'BUYER',
    identity: 'person',
    access: 'required',
  },
  TRANSPORTIST: {
    link: 'TRANSPORTIST',
    identity: 'person',
    access: 'required',
  },
};

export function docTypesOf(definition: DirectoryFormDefinition): readonly PartyDocType[] {
  return definition.identity === 'person' ? PERSON_DOC_TYPES : PARTY_DOC_TYPES;
}

/** El valor de un campo extra en el formulario: siempre texto, como lo guarda y valida el backend. */
export interface AttributeValueModel {
  attributeUuid: string;
  name: string;
  type: AttributeValueType;
  value: string;
}

/**
 * El bloque de acceso. O se crea un usuario (`username` y `password`), o se vincula uno que ya existe
 * (`existingUserUuid`): el de la persona, si ya entra al sistema, o el que el backend encontró con ese nombre.
 */
export interface AccessModel {
  /** En el tercero, el interruptor «Puede iniciar sesión». En el empleado vale siempre. */
  enabled: boolean;
  existingUserUuid: string;
  existingUsername: string;
  username: string;
  password: string;
  roleUuids: string[];
}

/** Todos los campos que puede pedir un formulario del directorio. Cada vínculo usa los suyos. */
export interface DirectoryFormModel {
  name: string;
  docType: PartyDocType | '';
  docNumber: string;
  taxCondition: string;
  /** El contacto del alta. En la edición, los contactos se administran con su propio editor. */
  email: string;
  /** La lista del cliente. */
  priceListUuid: string;
  /**
   * La lista con la que cotiza el vendedor. No es la del cliente: son dos campos de dos ABM, y la persona que es
   * cliente y vendedor a la vez los carga en el mismo formulario.
   */
  sellerPriceListUuid: string;
  fileNumber: string;
  dateHired: string;
  branchUuid: string;
  licenseNumber: string;
  licenseClass: string;
  licenseExpiresOn: string;
  vehiclePlate: string;
  vehicleDescription: string;
  commissionRate: number | null;
  salesGoalAmount: number | null;
  attributes: AttributeValueModel[];
  access: AccessModel;
}

export const EMPTY_ACCESS: AccessModel = {
  enabled: false,
  existingUserUuid: '',
  existingUsername: '',
  username: '',
  password: '',
  roleUuids: [],
};

/**
 * El formulario de un alta en blanco, o el de una ficha que se edita. Sin vínculo es el de «Dar acceso»: no da de
 * alta nada, y sólo completa los datos de los vínculos que detecten los roles.
 */
export function toFormModel(
  link: DirectoryLink | null,
  profile: DirectoryProfileDto | null,
): DirectoryFormModel {
  const employee = link !== null && isEmployeeSpecialty(link);
  const employeeProfile = employee
    ? (profile as (EmployeeTypeProfileDto & { branch?: { uuid: string } | null }) | null)
    : null;
  const transportist = profile as TransportistProfileDto | null;
  const seller = profile as SellerProfileDto | null;
  const customer = profile as CustomerProfileDto | null;

  return {
    name: profile?.name ?? '',
    docType: profile?.docType ?? '',
    docNumber: profile?.docNumber ?? '',
    taxCondition: profile?.taxCondition ?? '',
    email: '',
    priceListUuid: (link === 'CUSTOMER' ? customer?.priceList?.uuid : null) ?? '',
    sellerPriceListUuid: (link === 'SELLER' ? seller?.priceList?.uuid : null) ?? '',
    fileNumber: employeeProfile?.fileNumber ?? '',
    dateHired: employeeProfile?.dateHired ?? '',
    branchUuid: employeeProfile?.branch?.uuid ?? '',
    licenseNumber: transportist?.licenseNumber ?? '',
    licenseClass: transportist?.licenseClass ?? '',
    licenseExpiresOn: transportist?.licenseExpiresOn ?? '',
    vehiclePlate: transportist?.vehiclePlate ?? '',
    vehicleDescription: transportist?.vehicleDescription ?? '',
    commissionRate: seller?.commissionRate ?? null,
    salesGoalAmount: seller?.salesGoalAmount ?? null,
    attributes: [],
    // El bloque de acceso es del alta. La edición de una ficha no toca el usuario: lo muestra, y darle acceso
    // es otra acción.
    access: {
      ...EMPTY_ACCESS,
      enabled: profile === null && link !== null && DIRECTORY_FORMS[link].access === 'required',
    },
  };
}

/** Un texto del formulario tal como viaja: recortado, y vacío como `null`. */
function text(value: string): string | null {
  return value.trim() || null;
}

function ref(uuid: string): { uuid: string } | null {
  return uuid ? { uuid } : null;
}

/**
 * Los datos propios del vínculo, planos como los espera su ficha: los mismos para el alta, la edición y el
 * bloque de datos de una especialidad que se otorga.
 */
export function linkData(link: DirectoryLink, model: DirectoryFormModel): Record<string, unknown> {
  switch (link) {
    case 'CUSTOMER':
      return { priceList: ref(model.priceListUuid) };
    case 'SUPPLIER':
      return {};
    case 'SELLER':
      return {
        priceList: ref(model.sellerPriceListUuid),
        commissionRate: model.commissionRate,
        salesGoalAmount: model.salesGoalAmount,
      };
    case 'BUYER':
      return {};
    case 'TRANSPORTIST':
      return {
        licenseNumber: text(model.licenseNumber),
        licenseClass: text(model.licenseClass),
        licenseExpiresOn: model.licenseExpiresOn || null,
        vehiclePlate: text(model.vehiclePlate),
        vehicleDescription: text(model.vehicleDescription),
      };
  }
}

/** Lo que es del empleado y no de su especialidad: legajo, ingreso y la sucursal donde trabaja. */
function employeeData(link: DirectoryLink, model: DirectoryFormModel): Record<string, unknown> {
  if (!isEmployeeSpecialty(link)) {
    return {};
  }
  return {
    fileNumber: text(model.fileNumber),
    dateHired: model.dateHired || null,
    branch: ref(model.branchUuid),
  };
}

/**
 * La ficha del tipo, plana. La condición frente al IVA sólo la mandan las fichas fiscales: el backend no la
 * escribe desde una de empleado, y mandarla vacía desde ahí no significaría nada.
 */
export function profilePayload(
  link: DirectoryLink,
  model: DirectoryFormModel,
  base: { uuid?: string; version?: number; partyUuid?: string } = {},
): Record<string, unknown> {
  const docNumber = text(model.docNumber);
  const docType = model.docType || null;
  const identity: Record<string, unknown> = {
    name: model.name.trim(),
    // Tipo y número van juntos o no van: con uno solo el backend responde `PARTY_DOCUMENT_INCOMPLETE`.
    docType: docNumber ? docType : null,
    docNumber: docType ? docNumber : null,
  };
  if (DIRECTORY_FORMS[link].identity === 'fiscal') {
    identity['taxCondition'] = text(model.taxCondition);
  }

  return {
    ...(base.uuid ? { uuid: base.uuid, version: base.version } : {}),
    ...(base.partyUuid ? { partyUuid: base.partyUuid } : {}),
    ...identity,
    ...employeeData(link, model),
    ...linkData(link, model),
  };
}

/**
 * El pedido de usuario del bloque de acceso, o nada si la persona no va a entrar. Un tercero con el
 * interruptor apagado **no manda ningún campo de credencial**, aunque se hayan tipeado antes de apagarlo.
 *
 * `links` son los vínculos que los roles piden además de los que la ficha tiene: viajan con el usuario porque son
 * sus roles los que los hacen necesarios.
 */
export function userLinkRequest(
  access: AccessModel,
  email: string,
  links: readonly DirectoryLinkProfileRequest[] = [],
): PartyUserLinkRequest | undefined {
  if (!access.enabled) {
    return undefined;
  }
  const extra = links.length > 0 ? { links: [...links] } : {};
  if (access.existingUserUuid) {
    return { userUuid: access.existingUserUuid, roleUuids: [...access.roleUuids], ...extra };
  }
  return {
    username: access.username.trim(),
    password: access.password,
    email: text(email),
    roleUuids: [...access.roleUuids],
    ...extra,
  };
}

/** Los campos extra que se completaron. Uno vacío no viaja: no completarlo es no tenerlo. */
export function attributeValues(
  model: DirectoryFormModel,
): { attributeUuid: string; value: string }[] {
  return model.attributes
    .filter((attribute) => attribute.value.trim() !== '')
    .map((attribute) => ({
      attributeUuid: attribute.attributeUuid,
      value: attribute.value.trim(),
    }));
}

/**
 * El alta compuesta. Sumarle el vínculo a una ficha que ya existe manda su `partyUuid` y **ni la identidad ni
 * los contactos**: ya estaban cargados, y lo que se acababa de tipear no los pisa.
 */
export function onboardRequest(
  link: DirectoryLink,
  model: DirectoryFormModel,
  existingPartyUuid: string | null,
  extraLinks: ExtraLinksPlan = NO_EXTRA_LINKS,
): OnboardRequest {
  const request: OnboardRequest = {
    profile: profilePayload(link, model, existingPartyUuid ? { partyUuid: existingPartyUuid } : {}),
  };

  const email = text(model.email);
  if (email && !existingPartyUuid) {
    request.contacts = [{ type: 'EMAIL', value: email, isPrincipal: true }];
  }

  if (isEmployeeSpecialty(link)) {
    const values = attributeValues(model);
    if (values.length > 0) {
      request.attributes = values;
    }
  }

  const user = userLinkRequest(model.access, model.email, extraLinkProfiles(extraLinks, model));
  if (user) {
    request.user = user;
  }
  return request;
}

/**
 * El cuerpo de `POST /party/employee/{uuid}/specialty`: la especialidad y, a lo sumo, su bloque de datos. La que no
 * tiene datos propios —el comprador— no manda bloque: el backend no tiene dónde leerlo.
 */
export function specialtyGrantBody(
  link: DirectoryLink,
  model: DirectoryFormModel,
): Record<string, unknown> {
  const block = linkData(link, model);
  return Object.keys(block).length === 0
    ? { specialty: link }
    : { specialty: link, [link.toLowerCase()]: block };
}

/**
 * Los vínculos que los roles del acceso piden **además** del que da de alta el formulario, y que la ficha todavía no
 * tiene. Son obligatorios: sin ellos el backend responde `PARTY_LINKS_MISSING` y no guarda nada.
 */
export interface ExtraLinksPlan {
  /** En el orden del directorio. */
  links: readonly DirectoryLink[];
  /**
   * El vínculo que pide legajo, ingreso y sucursal: el primero de empleado, si la persona todavía no es empleado y
   * el formulario no los pide ya. Son del empleado y no de cada especialidad, así que se piden una sola vez.
   */
  employmentLink: DirectoryLink | null;
}

export const NO_EXTRA_LINKS: ExtraLinksPlan = { links: [], employmentLink: null };

/**
 * Arma el plan con lo que detectó el backend y lo que faltó al guardar (`missing`, de un `PARTY_LINKS_MISSING`).
 *
 * @param formLink el vínculo que da de alta el formulario: ya viene en el alta, así que no es un extra. `null` en
 *   «Dar acceso», que no da de alta ninguno.
 * @param personIsEmployee la persona ya es empleado: el legajo, el ingreso y la sucursal ya los tiene.
 */
export function planExtraLinks(
  detected: readonly DetectedDirectoryLinkDto[],
  missing: readonly string[],
  formLink: DirectoryLink | null,
  personIsEmployee: boolean,
): ExtraLinksPlan {
  const wanted = new Set<string>([
    ...detected.filter((candidate) => !candidate.alreadyHas).map((candidate) => candidate.link),
    ...missing,
  ]);
  const links = DIRECTORY_LINKS.filter((link) => wanted.has(link) && link !== formLink);
  const employmentAsked = personIsEmployee || (formLink !== null && isEmployeeSpecialty(formLink));
  return {
    links,
    employmentLink: employmentAsked ? null : (links.find(isEmployeeSpecialty) ?? null),
  };
}

/** Los vínculos extra como viajan en `user.links`: cada uno con los datos de su ABM, planos. */
export function extraLinkProfiles(
  plan: ExtraLinksPlan,
  model: DirectoryFormModel,
): DirectoryLinkProfileRequest[] {
  return plan.links.map((link) => ({
    link,
    profile: {
      ...(link === plan.employmentLink ? employeeData(link, model) : {}),
      ...linkData(link, model),
    },
  }));
}

/** Los permisos que hacen a la persona ser ese vínculo: le dicen al operador por qué se le piden sus datos. */
export function reasonsFor(
  detected: readonly DetectedDirectoryLinkDto[],
  link: DirectoryLink,
): readonly string[] {
  return detected.find((candidate) => candidate.link === link)?.because ?? [];
}

/** Los catálogos que usan los campos de unos vínculos. */
export interface DirectoryCatalogNeeds {
  branches: boolean;
  priceLists: boolean;
}

export function catalogsFor(links: readonly DirectoryLink[]): DirectoryCatalogNeeds {
  return {
    // La sucursal donde trabaja cualquier empleado.
    branches: links.some(isEmployeeSpecialty),
    priceLists: links.includes('CUSTOMER') || links.includes('SELLER'),
  };
}

/**
 * Qué hacer cuando el documento tipeado ya es de una ficha de la empresa. Es la bifurcación del alta: el único
 * por documento impide crear otra ficha, así que el alta deja de ser un alta.
 *
 * - `open`: la persona ya tiene **este** vínculo. Es un duplicado de verdad, y se abre su ficha.
 * - `addLink`: la tiene con otro vínculo. Se le suma éste y se piden sólo sus campos.
 * - `addSpecialty`: ya es empleado, con otra especialidad. El legajo, el ingreso y la sucursal ya los tiene, así
 *   que se le otorga la especialidad y se piden sólo sus datos.
 */
export type ExistingPartyDecision =
  | { kind: 'open'; party: PartyDto; recordUuid: string }
  | { kind: 'addLink'; party: PartyDto }
  | { kind: 'addSpecialty'; party: PartyDto; employeeUuid: string; specialties: readonly string[] };

/**
 * Decide con la ficha encontrada. En un vínculo de empleado hace falta saber sus especialidades vigentes
 * (`specialties`), y sólo si ya es empleado: la ficha del maestro dice «empleado», no de qué tipo.
 */
export function decideExistingParty(
  link: DirectoryLink,
  party: PartyDto,
  specialties: readonly string[] = [],
): ExistingPartyDecision {
  if (!isEmployeeSpecialty(link)) {
    const role = roleOf(party, link);
    return role ? { kind: 'open', party, recordUuid: role.uuid } : { kind: 'addLink', party };
  }

  const employee = roleOf(party, 'EMPLOYEE');
  if (!employee) {
    return { kind: 'addLink', party };
  }
  if (specialties.includes(link)) {
    return { kind: 'open', party, recordUuid: employee.uuid };
  }
  return { kind: 'addSpecialty', party, employeeUuid: employee.uuid, specialties };
}

/**
 * Los roles con los que arranca el bloque de acceso: los de sistema del vínculo que quien carga puede otorgar.
 * Uno que no puede no se elige solo —sería un `403` seguro al guardar—, pero se sigue ofreciendo, marcado.
 */
export function initialRoleUuids(suggested: readonly SuggestedRoleDto[]): string[] {
  return suggested.filter((role) => role.system && role.grantable).map((role) => role.uuid);
}

/**
 * Los vínculos que una persona ya tiene: cliente y proveedor por sus roles del maestro, y las especialidades si
 * es empleado —el maestro dice «empleado», no de qué tipo—. Son los que dicen qué roles sugerirle al darle acceso.
 */
export function linksOfParty(party: PartyDto, specialties: readonly string[]): DirectoryLink[] {
  const links: DirectoryLink[] = [];
  for (const role of party.roles ?? []) {
    if (role.role === 'CUSTOMER' || role.role === 'SUPPLIER') {
      links.push(role.role);
    }
  }
  for (const specialty of specialties) {
    if (isEmployeeSpecialty(specialty)) {
      links.push(specialty);
    }
  }
  return links;
}

/** Los sugeridos de varios vínculos juntos, sin repetir un rol que sugieren dos. */
export function mergeSuggestedRoles(
  lists: readonly (readonly SuggestedRoleDto[])[],
): SuggestedRoleDto[] {
  const byUuid = new Map<string, SuggestedRoleDto>();
  for (const role of lists.flat()) {
    if (!byUuid.has(role.uuid)) {
      byUuid.set(role.uuid, role);
    }
  }
  return [...byUuid.values()];
}
