import { Component, computed, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { UuidNameRef } from '../../../../core/http/api-refs';
import { DirectoryLink } from '../../../../core/parties/directory-links';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { AccessModel } from '../../data-access/directory-forms';
import { SuggestedRoleDto } from '../../data-access/directory.model';

/**
 * Cómo se presenta el bloque:
 * - `optional`: el tercero. Un interruptor apagado, y apagado no pide nada.
 * - `required`: el empleado. Siempre prendido, porque su trabajo queda firmado a su nombre.
 * - `grant`: «Dar acceso» a alguien que ya está cargado. Siempre prendido, sin el porqué de un tipo.
 */
export type AccessBlockVariant = 'optional' | 'required' | 'grant';

/** Los sugeridos se leen aparte, y pueden no llegar: sin `party.user_link` el backend responde `403`. */
export type SuggestedRolesState = 'loading' | 'ready' | 'forbidden' | 'error';

/** Un rol tal como lo muestra el bloque: con lo que se sepa de él. */
interface RoleView extends UuidNameRef {
  suggested: boolean;
  system: boolean;
  /** `null` cuando no se sabe: sólo los sugeridos traen si quien carga los puede otorgar. */
  grantable: boolean | null;
}

/**
 * «Entra al sistema»: el usuario de la persona y los roles del Core que se le otorgan.
 *
 * **El bloque no decide permisos.** Propone los roles que el backend sugiere para el vínculo —el de sistema
 * viene elegido, y los personalizados que son ese vínculo por sus permisos se ofrecen primero al agregar—, y quien
 * carga los ajusta. Si los roles elegidos hacen a la persona otro vínculo, el formulario que lo contiene pide sus
 * datos. Un rol que quien carga no podría otorgar se muestra igual, marcado: si lo manda, el backend responde
 * `403 PRIVILEGE_ESCALATION`, y el formulario lo muestra en vez de esconderlo.
 *
 * Escribe directamente sobre el árbol del formulario que lo contiene: la validación —usuario y contraseña
 * obligatorios mientras el bloque está prendido— vive con ese formulario.
 */
@Component({
  selector: 'app-directory-access-block',
  imports: [
    FormField,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSlideToggleModule,
    TranslatePipe,
    FieldErrorPipe,
  ],
  templateUrl: './directory-access-block.component.html',
  styleUrl: './directory-access-block.component.css',
})
export class DirectoryAccessBlockComponent {
  readonly access = input.required<FieldTree<AccessModel>>();
  readonly variant = input.required<AccessBlockVariant>();
  /** El vínculo que se da de alta: dice por qué hace falta el acceso. Ausente en `grant`. */
  readonly link = input<DirectoryLink | null>(null);
  readonly suggested = input<readonly SuggestedRoleDto[]>([]);
  readonly suggestedState = input<SuggestedRolesState>('ready');
  /** Todos los roles asignables de la empresa, si quien carga puede verlos. */
  readonly roles = input<readonly UuidNameRef[]>([]);
  /** Los roles que el usuario ya tiene en la empresa: no se ofrecen de nuevo. */
  readonly currentRoleUuids = input<readonly string[]>([]);
  /** Quien carga puede dar acceso: tiene `party.user_link` y el permiso de usuarios. */
  readonly canGrant = input(true);
  /**
   * El usuario que el backend encontró con el nombre tipeado, si entra a esta empresa. Es lo que permite
   * ofrecer «vincular ese usuario» en vez de un «ya existe» sin salida.
   */
  readonly takenUser = input<UuidNameRef | null>(null);
  /**
   * La persona ya entra al sistema con su usuario. Dos logins para la misma persona en la misma empresa no es un
   * estado posible, así que el bloque sólo le suma roles a ése y no ofrece crear otro.
   */
  readonly personHasUser = input(false);

  private static nextId = 0;
  protected readonly ids = {
    heading: `directory-access-${DirectoryAccessBlockComponent.nextId}`,
    roles: `directory-access-roles-${DirectoryAccessBlockComponent.nextId++}`,
  };

  protected readonly enabled = computed(() => this.access().enabled().value());
  protected readonly existingUserUuid = computed(() => this.access().existingUserUuid().value());
  protected readonly existingUsername = computed(() => this.access().existingUsername().value());

  /** Todos los roles que el bloque conoce, por uuid: los sugeridos con lo que dicen de sí, y el resto. */
  private readonly known = computed(() => {
    const byUuid = new Map<string, RoleView>();
    for (const role of this.roles()) {
      byUuid.set(role.uuid, { ...role, suggested: false, system: false, grantable: null });
    }
    for (const role of this.suggested()) {
      byUuid.set(role.uuid, {
        uuid: role.uuid,
        name: role.name,
        suggested: true,
        system: role.system,
        grantable: role.grantable,
      });
    }
    return byUuid;
  });

  protected readonly selectedRoles = computed<RoleView[]>(() =>
    this.access()
      .roleUuids()
      .value()
      .map(
        (uuid) =>
          this.known().get(uuid) ?? {
            uuid,
            name: uuid,
            suggested: false,
            system: false,
            grantable: null,
          },
      ),
  );

  /**
   * Lo que ofrece «agregar»: primero los sugeridos —los personalizados que son el vínculo por sus permisos
   * antes que el de sistema—, después el resto de los roles de la empresa. Nunca los que ya están elegidos ni
   * los que el usuario ya tiene.
   */
  protected readonly candidates = computed<RoleView[]>(() => {
    const taken = new Set([...this.access().roleUuids().value(), ...this.currentRoleUuids()]);
    const all = [...this.known().values()].filter((role) => !taken.has(role.uuid));
    const rank = (role: RoleView): number => (role.suggested ? (role.system ? 1 : 0) : 2);
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  });

  protected onToggle(enabled: boolean): void {
    this.access().enabled().value.set(enabled);
  }

  protected onAddRole(uuid: string): void {
    const roleUuids = this.access().roleUuids();
    if (!roleUuids.value().includes(uuid)) {
      roleUuids.value.set([...roleUuids.value(), uuid]);
    }
  }

  protected onRemoveRole(uuid: string): void {
    const roleUuids = this.access().roleUuids();
    roleUuids.value.set(roleUuids.value().filter((candidate) => candidate !== uuid));
  }

  /** Usar el usuario que ya existe con ese nombre, en vez de crear otro. */
  protected onUseTakenUser(user: UuidNameRef): void {
    const access = this.access();
    access.existingUserUuid().value.set(user.uuid);
    access.existingUsername().value.set(user.name);
    access.password().value.set('');
  }

  /** Volver a crear un usuario nuevo. */
  protected onCreateNewUser(): void {
    const access = this.access();
    access.existingUserUuid().value.set('');
    access.existingUsername().value.set('');
  }
}
