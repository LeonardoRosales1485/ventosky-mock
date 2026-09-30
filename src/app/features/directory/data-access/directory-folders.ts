import { Permission, Permissions } from '../../../core/auth/permissions';
import {
  DirectoryLink,
  EMPLOYEE_SPECIALTIES,
  DIRECTORY_LINKS,
} from '../../../core/parties/directory-links';
import {
  MatTablePaginatorGlobalSearchConfig,
  MatTablePaginatorSortConfigMap,
} from '../../../core/paginate';

/**
 * Las carpetas del directorio, en el orden del árbol.
 *
 * **La carpeta donde se está parado decide qué se ve y qué se pregunta**: cada una lista con sus columnas y da
 * de alta con su formulario. Las que listan varios ABM —«Todos» y «Empleados»— no tienen formulario propio: su
 * botón pide elegir el tipo, porque una pantalla que cruza tres ABM no puede pedir los campos de ninguno.
 */
export const DIRECTORY_FOLDER_IDS = [
  'all',
  'customers',
  'suppliers',
  'employees',
  'sellers',
  'buyers',
  'transportists',
  'access',
] as const;
export type DirectoryFolderId = (typeof DIRECTORY_FOLDER_IDS)[number];

/** Una columna del listado. Cada carpeta elige las suyas; la plantilla sabe dibujar todas. */
export type DirectoryColumn =
  | 'name'
  | 'document'
  | 'roles'
  | 'username'
  | 'priceList'
  | 'fileNumber'
  | 'dateHired'
  | 'specialties'
  | 'branch'
  | 'licenseNumber'
  | 'licenseClass'
  | 'licenseExpiresOn'
  | 'vehicle'
  | 'sellerPriceList'
  | 'commissionRate'
  | 'salesGoalAmount'
  | 'grantedRoles'
  | 'directoryRoles';

/** Qué hace el botón de alta de la carpeta. */
export type DirectoryCreateAction =
  /** Abre el formulario del vínculo. */
  | { kind: 'form'; link: DirectoryLink }
  /** Pide elegir el tipo primero: la carpeta lista varios ABM. */
  | { kind: 'menu'; links: readonly DirectoryLink[] }
  /** No es un alta: le suma credencial a una ficha que ya existe. */
  | { kind: 'access' };

export interface DirectoryFolder {
  id: DirectoryFolderId;
  /** Se dibuja colgando de la carpeta de arriba: los tipos de empleado, de «Empleados». */
  child?: boolean;
  /**
   * Hacen falta **todos** para ver la carpeta. «Todos» pide los tres de lectura del maestro: cruza tres ABM, y
   * quien sólo puede ver clientes no tiene por qué ver ahí a los proveedores y a los empleados.
   */
  permissions: readonly Permission[];
  columns: readonly DirectoryColumn[];
  create: DirectoryCreateAction;
  /** El listado esconde a quien tiene fecha de egreso, y la carpeta ofrece incluirlo. */
  hidesTerminated?: boolean;
}

export const DIRECTORY_FOLDERS: readonly DirectoryFolder[] = [
  {
    id: 'all',
    permissions: [Permissions.customerView, Permissions.supplierView, Permissions.employeeView],
    columns: ['name', 'document', 'roles', 'username'],
    create: { kind: 'menu', links: DIRECTORY_LINKS },
  },
  {
    id: 'customers',
    permissions: [Permissions.customerView],
    columns: ['name', 'document', 'priceList', 'username'],
    create: { kind: 'form', link: 'CUSTOMER' },
  },
  {
    id: 'suppliers',
    permissions: [Permissions.supplierView],
    columns: ['name', 'document', 'username'],
    create: { kind: 'form', link: 'SUPPLIER' },
  },
  {
    id: 'employees',
    permissions: [Permissions.employeeView],
    columns: ['name', 'fileNumber', 'dateHired', 'specialties', 'branch', 'username'],
    create: { kind: 'menu', links: EMPLOYEE_SPECIALTIES },
    hidesTerminated: true,
  },
  {
    id: 'sellers',
    child: true,
    permissions: [Permissions.employeeView],
    columns: [
      'name',
      'fileNumber',
      'sellerPriceList',
      'commissionRate',
      'salesGoalAmount',
      'branch',
    ],
    create: { kind: 'form', link: 'SELLER' },
    hidesTerminated: true,
  },
  {
    id: 'buyers',
    child: true,
    permissions: [Permissions.employeeView],
    columns: ['name', 'fileNumber', 'branch', 'username'],
    create: { kind: 'form', link: 'BUYER' },
    hidesTerminated: true,
  },
  {
    id: 'transportists',
    child: true,
    permissions: [Permissions.employeeView],
    columns: ['name', 'fileNumber', 'licenseNumber', 'licenseClass', 'licenseExpiresOn', 'vehicle'],
    create: { kind: 'form', link: 'TRANSPORTIST' },
    hidesTerminated: true,
  },
  {
    id: 'access',
    permissions: [Permissions.userView],
    columns: ['name', 'username', 'grantedRoles', 'directoryRoles'],
    create: { kind: 'access' },
  },
];

export function isDirectoryFolderId(value: unknown): value is DirectoryFolderId {
  return typeof value === 'string' && (DIRECTORY_FOLDER_IDS as readonly string[]).includes(value);
}

export function directoryFolder(id: DirectoryFolderId): DirectoryFolder {
  const folder = DIRECTORY_FOLDERS.find((candidate) => candidate.id === id);
  if (!folder) {
    throw new Error(`Carpeta del directorio desconocida: ${id}`);
  }
  return folder;
}

/** Las carpetas que el usuario puede abrir, en el orden del árbol. */
export function visibleDirectoryFolders(
  hasPermission: (permission: Permission) => boolean,
): DirectoryFolder[] {
  return DIRECTORY_FOLDERS.filter((folder) => folder.permissions.every(hasPermission));
}

/** La carpeta de cada vínculo: donde se lista lo que su formulario da de alta. */
export function folderOfLink(link: DirectoryLink): DirectoryFolderId {
  const folder = DIRECTORY_FOLDERS.find(
    (candidate) => candidate.create.kind === 'form' && candidate.create.link === link,
  );
  if (!folder) {
    throw new Error(`Vínculo sin carpeta: ${link}`);
  }
  return folder.id;
}

/** Con qué busca, ordena y abre ordenada la carpeta. */
export interface DirectoryTableConfig {
  search: MatTablePaginatorGlobalSearchConfig[];
  sort: MatTablePaginatorSortConfigMap;
  defaultSort: { columnKey: DirectoryColumn; direction: 'asc' | 'desc' };
}

/**
 * Las tablas contra las que filtra el paginado de cada carpeta.
 *
 * Las fichas de rol se paginan sobre `party_roles`, pero el nombre y el documento viven en `parties`, que el
 * backend ya deja unida; las de empleado unen además `party_employees`, donde está el legajo. «Todos» pagina
 * `parties` directo y «Con acceso» pagina `auth_users`: ahí la tabla principal es `t`.
 */
export function directoryTableConfig(id: DirectoryFolderId): DirectoryTableConfig {
  if (id === 'all') {
    return {
      search: [
        { tabla: 't', columna: 'name' },
        { tabla: 't', columna: 'doc_number' },
      ],
      sort: { name: { tabla: 't', columna: 'name' } },
      defaultSort: { columnKey: 'name', direction: 'asc' },
    };
  }

  if (id === 'access') {
    return {
      search: [
        { tabla: 't', columna: 'username' },
        { tabla: 't', columna: 'email' },
      ],
      sort: { username: { tabla: 't', columna: 'username' } },
      defaultSort: { columnKey: 'username', direction: 'asc' },
    };
  }

  const identity: DirectoryTableConfig = {
    search: [
      { tabla: 'parties', columna: 'name' },
      { tabla: 'parties', columna: 'doc_number' },
    ],
    sort: {
      name: { tabla: 'parties', columna: 'name' },
      document: { tabla: 'parties', columna: 'doc_number' },
    },
    defaultSort: { columnKey: 'name', direction: 'asc' },
  };

  if (!directoryFolder(id).hidesTerminated) {
    return identity;
  }

  return {
    ...identity,
    search: [...identity.search, { tabla: 'party_employees', columna: 'file_number' }],
    sort: {
      ...identity.sort,
      fileNumber: { tabla: 'party_employees', columna: 'file_number' },
      dateHired: { tabla: 'party_employees', columna: 'date_hired' },
    },
  };
}

/**
 * El pseudo-filtro «incluir bajas» de los paginados de empleado: sin él, el backend esconde a quien tiene
 * fecha de egreso. Viaja como un filtro más de la columna `t.includeTerminated`, que el backend reescribe.
 */
export const INCLUDE_TERMINATED_FILTER = 'includeTerminated';
