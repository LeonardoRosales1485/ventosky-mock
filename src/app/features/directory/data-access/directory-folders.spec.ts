import { describe, expect, it } from 'vitest';
import { Permission, Permissions } from '../../../core/auth/permissions';
import {
  DIRECTORY_FOLDERS,
  directoryTableConfig,
  folderOfLink,
  visibleDirectoryFolders,
} from './directory-folders';

const only =
  (...granted: Permission[]) =>
  (permission: Permission): boolean =>
    granted.includes(permission);

describe('visibleDirectoryFolders', () => {
  it('shows only the customers folder to whoever can only see customers', () => {
    const folders = visibleDirectoryFolders(only(Permissions.customerView));

    expect(folders.map((folder) => folder.id)).toEqual(['customers']);
  });

  it('opens «Todos» only with the three read permissions of the directory', () => {
    const withoutEmployees = visibleDirectoryFolders(
      only(Permissions.customerView, Permissions.supplierView),
    );
    const withAll = visibleDirectoryFolders(
      only(Permissions.customerView, Permissions.supplierView, Permissions.employeeView),
    );

    expect(withoutEmployees.map((folder) => folder.id)).not.toContain('all');
    expect(withAll[0].id).toBe('all');
  });

  it('lists the three employee types under «Empleados», in the tree order', () => {
    const folders = visibleDirectoryFolders(only(Permissions.employeeView));

    expect(folders.map((folder) => folder.id)).toEqual([
      'employees',
      'sellers',
      'buyers',
      'transportists',
    ]);
    expect(folders.filter((folder) => folder.child).map((folder) => folder.id)).toEqual([
      'sellers',
      'buyers',
      'transportists',
    ]);
  });

  it('shows «Con acceso al sistema» with the user permission alone', () => {
    expect(visibleDirectoryFolders(only(Permissions.userView)).map((folder) => folder.id)).toEqual([
      'access',
    ]);
  });
});

describe('DIRECTORY_FOLDERS', () => {
  /** «Todos» y «Empleados» cruzan varios ABM: su botón pide elegir el tipo en vez de abrir un formulario. */
  it('gives a form only to the folders of a single link', () => {
    const kinds = Object.fromEntries(
      DIRECTORY_FOLDERS.map((folder) => [folder.id, folder.create.kind]),
    );

    expect(kinds).toEqual({
      all: 'menu',
      customers: 'form',
      suppliers: 'form',
      employees: 'menu',
      sellers: 'form',
      buyers: 'form',
      transportists: 'form',
      access: 'access',
    });
  });

  it('maps every link to the folder that lists it', () => {
    expect(folderOfLink('CUSTOMER')).toBe('customers');
    expect(folderOfLink('SELLER')).toBe('sellers');
    expect(folderOfLink('BUYER')).toBe('buyers');
    expect(folderOfLink('TRANSPORTIST')).toBe('transportists');
  });

  it('searches the employee number only where the listing joins the employee', () => {
    const transportists = directoryTableConfig('transportists').search.map(
      (config) => config.columna,
    );
    const customers = directoryTableConfig('customers').search.map((config) => config.columna);

    expect(transportists).toContain('file_number');
    expect(customers).not.toContain('file_number');
    expect(directoryTableConfig('access').search.map((config) => config.columna)).toEqual([
      'username',
      'email',
    ]);
  });
});
