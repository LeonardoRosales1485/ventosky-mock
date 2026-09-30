export interface AuthUserDto {
  uuid: string;
  username: string;
  userCompanyRoles: AuthUserCompanyRole[];
}

export interface AuthUserCompany {
  companyCuit: string | null;
  companyName: string | null;
  companyUuid: string;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated: string;
  status: number;
  uuid: string;
}

export interface AuthUserCompanyRole extends AuthUserCompany {
  roles: Role[];
}

export interface Role {
  uuid: string;
  status: number;
  isDefault: boolean;
  name: string;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated: string;
  permissions: RolePermission[];
}

export interface RolePermission {
  name: string;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated: string;
  status: number;
  uuid: string;
}
export interface AuthDto {
  token: string;
  refresh: string;
}

export interface RefreshTokenDto {
  token: string;
  refresh: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface LogoutOptions {
  requireConfirmation?: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface RefreshTokenRequest {
  refresh: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface ResetPasswordRequest {
  code: string;
  email: string;
  password: string;
}

export interface EmailChangeRequest {
  newEmail: string;
}

export interface EmailVerificationRequest {
  verificationCode: string;
}

/** Empresa "Sistema" sembrada por el backend; pertenecer a ella es lo que define a un SysAdmin. */
export const SYSTEM_COMPANY_UUID = '00000000-0000-0000-0000-000000000001';

export class AuthUser {
  public readonly uuid: string;
  public readonly username: string;

  public readonly companies: AuthUserCompany[];

  public readonly rolesByCompanyUuid: Map<string, Role[]>;
  public readonly roleNamesByCompanyUuid: Map<string, Set<string>>;
  public readonly permissionsByCompanyUuid: Map<string, Set<string>>;

  constructor(data: AuthUserDto) {
    this.uuid = data.uuid;
    this.username = data.username;
    this.companies = data.userCompanyRoles.map((companyWithRoles) => ({
      uuid: companyWithRoles.uuid,
      companyCuit: companyWithRoles.companyCuit,
      companyName: companyWithRoles.companyName,
      companyUuid: companyWithRoles.companyUuid,
      dateCreated: companyWithRoles.dateCreated,
      status: companyWithRoles.status,
    }));
    this.rolesByCompanyUuid = new Map(
      data.userCompanyRoles.map((companyWithRoles) => [
        companyWithRoles.companyUuid,
        companyWithRoles.roles,
      ]),
    );
    this.roleNamesByCompanyUuid = new Map(
      data.userCompanyRoles.map((companyWithRoles) => [
        companyWithRoles.companyUuid,
        new Set(companyWithRoles.roles.map((role) => role.name)),
      ]),
    );
    this.permissionsByCompanyUuid = new Map(
      data.userCompanyRoles.map((companyWithRoles) => [
        companyWithRoles.companyUuid,
        new Set(
          companyWithRoles.roles.flatMap((role) =>
            role.permissions.map((permission) => permission.name),
          ),
        ),
      ]),
    );
  }

  /**
   * Espeja `AuthService.isSysAdmin()`: alcanza con ser miembro de la empresa sistema. Sólo sirve
   * para ocultar acciones en la UI; la autorización real la aplica el backend.
   */
  public isSysAdmin(): boolean {
    return this.companies.some((company) => company.companyUuid === SYSTEM_COMPANY_UUID);
  }

  public hasRoleByCompanyUuid(companyUuid: string, roleName: string): boolean {
    return this.roleNamesByCompanyUuid.get(companyUuid)?.has(roleName) ?? false;
  }

  public hasPermissionByCompanyUuid(companyUuid: string, permission: string): boolean {
    const roles = this.rolesByCompanyUuid.get(companyUuid);
    if (!roles) {
      return false;
    }
    return this.permissionsByCompanyUuid.get(companyUuid)?.has(permission) ?? false;
  }

  public hasAllPermissionsByCompanyUuid(companyUuid: string, permissions: string[]): boolean {
    return permissions.every((permission) =>
      this.hasPermissionByCompanyUuid(companyUuid, permission),
    );
  }

  public hasAnyPermissionByCompanyUuid(companyUuid: string, permissions: string[]): boolean {
    return permissions.some((permission) =>
      this.hasPermissionByCompanyUuid(companyUuid, permission),
    );
  }
}
