import { SYSTEM_COMPANY_UUID } from '../../../core/auth/auth.models';
import { UuidNameRef } from '../../../core/http/api-refs';
import { DirectoryUserDto } from './directory.model';

/**
 * Lo que un usuario puede hacer en la empresa activa: los roles de su vínculo con ella y, si pertenece a la
 * empresa sistema, los de ahí, que le valen en todas —es la misma regla con la que el backend suma sus
 * permisos—. Un rol que aparece en los dos vínculos se nombra una vez.
 */
export function rolesInCompany(user: DirectoryUserDto, companyUuid: string | null): UuidNameRef[] {
  const byUuid = new Map<string, UuidNameRef>();
  for (const link of user.userCompanyRoles ?? []) {
    if (link.companyUuid !== companyUuid && link.companyUuid !== SYSTEM_COMPANY_UUID) {
      continue;
    }
    for (const role of link.roles ?? []) {
      byUuid.set(role.uuid, { uuid: role.uuid, name: role.name });
    }
  }
  return [...byUuid.values()];
}
