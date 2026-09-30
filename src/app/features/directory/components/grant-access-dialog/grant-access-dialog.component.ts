import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  FormField,
  TreeValidationResult,
  email,
  form,
  maxLength,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  Observable,
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  forkJoin,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorData,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { UuidNameRef } from '../../../../core/http/api-refs';
import {
  DirectoryLink,
  DirectoryLinkDetectRequest,
} from '../../../../core/parties/directory-links';
import { PartiesApiService } from '../../../../core/parties/parties-api.service';
import {
  PARTY_CONTACT_VALUE_MAX_LENGTH,
  PartyDto,
  formatDocument,
  roleOf,
} from '../../../../core/parties/party.model';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { DirectoryApiService } from '../../data-access/directory-api.service';
import { DirectoryCatalogApiService } from '../../data-access/directory-catalog-api.service';
import { DirectoryFormCatalogs } from '../../data-access/directory-form-catalogs';
import {
  DirectoryFormModel,
  EMPTY_ACCESS,
  extraLinkProfiles,
  initialRoleUuids,
  linksOfParty,
  mergeSuggestedRoles,
  planExtraLinks,
  toFormModel,
  userLinkRequest,
} from '../../data-access/directory-forms';
import {
  detectDirectoryLinks,
  sameDetectRequest,
} from '../../data-access/directory-link-detection';
import { DirectoryUserDto, SuggestedRoleDto } from '../../data-access/directory.model';
import { rolesInCompany } from '../../data-access/directory-users';
import {
  DirectoryAccessBlockComponent,
  SuggestedRolesState,
} from '../directory-access-block/directory-access-block.component';
import { DirectoryExtraLinksComponent } from '../directory-extra-links/directory-extra-links.component';
import { accessSchema, linkFieldsSchema } from '../directory-form-dialog/directory-form.schema';

export interface GrantAccessDialogData {
  /** La persona a la que se le da acceso. Sin ella, el diálogo arranca buscándola en el directorio. */
  party?: PartyDto | null;
  /**
   * Un usuario que no es de nadie del directorio, para vincularlo con una persona. El contador externo no lo
   * necesita —entra sin ser tercero de la empresa—, pero el vendedor que se cargó primero como usuario sí.
   */
  user?: DirectoryUserDto | null;
}

export type GrantAccessDialogResult =
  | { kind: 'granted'; name: string }
  | { kind: 'rolesAdded'; username: string }
  | { kind: 'unlinked'; name: string };

/**
 * El formulario de «Dar acceso»: el de un alta sin vínculo. Usa el email y el acceso, y los campos de los vínculos
 * que detecten los roles; la identidad no, que no se toca.
 */
function grantModel(
  email = '',
  access: Partial<DirectoryFormModel['access']> = {},
): DirectoryFormModel {
  return {
    ...toFormModel(null, null),
    email,
    access: { ...EMPTY_ACCESS, enabled: true, ...access },
  };
}

/** Desde cuántas letras busca. Con una sola, cualquier búsqueda devuelve medio directorio. */
const MIN_SEARCH_LENGTH = 2;

/**
 * «Dar acceso a alguien que ya está». **No es un alta**: le suma credencial a una ficha que ya existe, y los
 * datos de la persona no se tocan acá.
 *
 * Lo que sí puede sumar son vínculos: si los roles que se le dan la hacen ser algo que no es —el cliente con un rol
 * de reparto es transportista—, el diálogo lo detecta y pide los datos de ese vínculo, que se crea con el acceso.
 *
 * Si la persona ya tiene usuario, el diálogo edita ése en vez de crear otro —dos logins para la misma persona en
 * la misma empresa no es un estado posible—: le suma roles, o la desvincula. Desvincular **no le saca el
 * acceso**: el usuario y sus roles quedan, y quitarle el acceso es editar el usuario. El diálogo lo dice antes de
 * hacerlo, porque «desvincular» se lee como «sacarle el acceso».
 */
@Component({
  selector: 'app-grant-access-dialog',
  imports: [
    FormField,
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
    FieldErrorPipe,
    DirectoryAccessBlockComponent,
    DirectoryExtraLinksComponent,
  ],
  providers: [DirectoryApiService, DirectoryCatalogApiService, DirectoryFormCatalogs],
  templateUrl: './grant-access-dialog.component.html',
  styleUrl: './grant-access-dialog.component.css',
})
export class GrantAccessDialogComponent implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<GrantAccessDialogComponent, GrantAccessDialogResult>,
  );
  private readonly data = inject<GrantAccessDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(DirectoryApiService);
  private readonly catalog = inject(DirectoryCatalogApiService);
  private readonly partiesApi = inject(PartiesApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly catalogs = inject(DirectoryFormCatalogs);
  /** Un usuario sin ficha que se viene a vincular. */
  protected readonly linkingUser = this.data.user ?? null;
  /** La persona llegó elegida desde afuera: no se ofrece cambiarla. */
  protected readonly presetParty = !!this.data.party;

  protected readonly party = signal<PartyDto | null>(null);
  protected readonly currentUser = signal<DirectoryUserDto | null>(null);

  protected readonly searchTerm = signal('');
  protected readonly searching = signal(false);
  protected readonly searchFailed = signal(false);
  protected readonly results = signal<PartyDto[]>([]);

  protected readonly suggested = signal<SuggestedRoleDto[]>([]);
  protected readonly suggestedState = signal<SuggestedRolesState>('loading');
  protected readonly roles = signal<UuidNameRef[]>([]);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly takenUser = signal<UuidNameRef | null>(null);

  protected readonly model = signal<DirectoryFormModel>(grantModel());
  protected readonly grantForm = form(this.model, (path) => {
    email(path.email);
    maxLength(path.email, PARTY_CONTACT_VALUE_MAX_LENGTH);
    linkFieldsSchema(path);
    accessSchema(path.access);
  });

  protected readonly canGrant =
    this.auth.hasPermission(Permissions.partyUserLink) &&
    (this.auth.hasPermission(Permissions.userCreate) ||
      this.auth.hasPermission(Permissions.userEdit));
  /** Desvincular pide `party.user_link` y `user.edit`: toca el vínculo de alguien que ya entra. */
  protected readonly canUnlink =
    this.auth.hasPermission(Permissions.partyUserLink) &&
    this.auth.hasPermission(Permissions.userEdit);

  /** La persona ya entra con su usuario: el diálogo lo edita. */
  protected readonly personUser = computed(() => {
    const party = this.party();
    return party?.userUuid ? { uuid: party.userUuid, name: party.username ?? '' } : null;
  });

  /** El usuario que se venía a vincular choca con el que la persona ya tiene. */
  protected readonly userConflict = computed(() => {
    const own = this.personUser();
    return !!own && !!this.linkingUser && own.uuid !== this.linkingUser.uuid;
  });

  protected readonly currentRoles = computed(() =>
    this.currentUser() ? rolesInCompany(this.currentUser()!, this.auth.selectedCompanyUuid()) : [],
  );
  protected readonly currentRoleUuids = computed(() =>
    this.currentRoles().map((role) => role.uuid),
  );

  protected readonly document = computed(() => {
    const party = this.party();
    return party?.docNumber ? formatDocument(party) : null;
  });

  protected readonly submitLabelKey = computed(() => {
    if (this.personUser()) {
      return 'directory.grant.addRoles';
    }
    return this.linkingUser ? 'directory.grant.linkUser' : 'directory.grant.submit';
  });

  /**
   * Qué se mide para saber qué vínculos piden los roles: los que se le dan, los que ya tiene el usuario con el que
   * entra, y la ficha, que dice cuáles ya es.
   */
  private readonly detectRequest = computed<DirectoryLinkDetectRequest | null>(
    () => {
      const party = this.party();
      const access = this.model().access;
      if (!party || !this.canGrant || (access.roleUuids.length === 0 && !access.existingUserUuid)) {
        return null;
      }
      return {
        roleUuids: access.roleUuids,
        partyUuid: party.uuid,
        userUuid: access.existingUserUuid || null,
      };
    },
    { equal: sameDetectRequest },
  );

  protected readonly detection = detectDirectoryLinks(this.detectRequest);

  /** Los vínculos que el backend dijo que faltaban al guardar. Se olvidan cuando cambian los roles. */
  private readonly missingLinks = linkedSignal<DirectoryLinkDetectRequest | null, string[]>({
    source: this.detectRequest,
    computation: () => [],
  });

  /** Los vínculos que los roles piden y la persona no tiene: se crean con el acceso, con sus datos. */
  protected readonly extraLinks = computed(() => {
    const party = this.party();
    return planExtraLinks(
      this.detection().detected,
      this.missingLinks(),
      null,
      !!party && !!roleOf(party, 'EMPLOYEE'),
    );
  });

  protected readonly submitDisabled = computed(() => {
    const access = this.model().access;
    return (
      this.saving() ||
      !this.party() ||
      !this.canGrant ||
      // Hasta saber qué vínculos piden los roles, no se sabe qué datos faltan.
      this.detection().status === 'loading' ||
      // Sumar roles a quien ya entra sin elegir ninguno no haría nada.
      (!!access.existingUserUuid &&
        !!this.personUser() &&
        access.roleUuids.length === 0 &&
        this.extraLinks().links.length === 0)
    );
  });

  constructor() {
    toObservable(this.searchTerm)
      .pipe(
        map((term) => term.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => this.searchFailed.set(false)),
        filter((term) => {
          if (term.length < MIN_SEARCH_LENGTH) {
            this.results.set([]);
            return false;
          }
          return true;
        }),
        tap(() => this.searching.set(true)),
        switchMap((term) =>
          this.partiesApi.searchByTerm(term).pipe(
            catchError(() => {
              this.searchFailed.set(true);
              return of<PartyDto[]>([]);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((parties) => {
        this.results.set(parties);
        this.searching.set(false);
      });

    // Los selects de cada vínculo que sumen los roles, cuando aparece.
    effect(() => this.catalogs.requireFor(this.extraLinks().links));
  }

  ngOnInit(): void {
    if (this.auth.hasPermission(Permissions.roleView)) {
      this.catalog
        .roles()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (roles) => this.roles.set(roles), error: () => this.roles.set([]) });
    }
    if (this.data.party) {
      this.onSelectParty(this.data.party);
    }
  }

  protected onSearchInput(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  /** Elegir la persona. Se relee: el listado de la búsqueda puede traer un usuario que ya cambió. */
  protected onSelectParty(candidate: PartyDto): void {
    this.errorMessage.set(null);
    this.takenUser.set(null);
    this.party.set(candidate);
    this.partiesApi
      .getByUuid(candidate.uuid)
      .pipe(
        catchError(() => of(candidate)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((party) => this.preparePerson({ ...candidate, ...party }));
  }

  protected onChangePerson(): void {
    this.party.set(null);
    this.currentUser.set(null);
    this.errorMessage.set(null);
    this.model.set(grantModel());
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.submitDisabled()) {
      return;
    }
    if (this.grantForm().invalid()) {
      this.grantForm().markAsTouched();
      return;
    }
    this.errorMessage.set(null);
    this.takenUser.set(null);
    void submit(this.grantForm, async () => {
      this.saving.set(true);
      try {
        return await this.link();
      } finally {
        this.saving.set(false);
      }
    });
  }

  protected onUnlink(): void {
    const party = this.party();
    const user = this.personUser();
    if (!party || !user) {
      return;
    }
    this.confirmDialog
      .confirm({
        message: this.translate.instant('directory.confirm.unlinkUser', {
          name: party.name,
          username: user.name,
        }),
        confirmLabel: this.translate.instant('directory.grant.unlink'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.partiesApi.unlinkUser(party.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.dialogRef.close({ kind: 'unlinked', name: party.name }),
        error: (error: unknown) => this.errorMessage.set(this.describeError(error)),
      });
  }

  private async link(): Promise<TreeValidationResult> {
    const party = this.party();
    const request = userLinkRequest(
      this.model().access,
      this.model().email,
      extraLinkProfiles(this.extraLinks(), this.model()),
    );
    if (!party || !request) {
      return undefined;
    }
    try {
      await firstValueFrom(this.partiesApi.linkUser(party.uuid, request));
      const own = this.personUser();
      this.dialogRef.close(
        own ? { kind: 'rolesAdded', username: own.name } : { kind: 'granted', name: party.name },
      );
      return undefined;
    } catch (error) {
      return this.onLinkError(error);
    }
  }

  private onLinkError(error: unknown): TreeValidationResult {
    const data = readApiErrorData(error) ?? {};

    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_USER_ALREADY_EXISTS)) {
      const userUuid = data['userUuid'];
      this.takenUser.set(
        typeof userUuid === 'string'
          ? { uuid: userUuid, name: this.model().access.username.trim() }
          : null,
      );
      return { fieldTree: this.grantForm.access.username, kind: 'usernameTaken' };
    }

    // La detección no llegó a tiempo o no se pudo hacer: el backend dice qué vínculos faltan, y aparecen.
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_LINKS_MISSING)) {
      const missing = data['missing'];
      this.missingLinks.set(
        Array.isArray(missing)
          ? missing.filter((link): link is string => typeof link === 'string')
          : [],
      );
    }

    // Alguien le dio acceso mientras tanto: el diálogo pasa a editar el usuario que quedó.
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_ALREADY_HAS_USER)) {
      const party = this.party();
      if (party && typeof data['userUuid'] === 'string') {
        this.preparePerson({
          ...party,
          userUuid: data['userUuid'],
          username: typeof data['username'] === 'string' ? data['username'] : '',
        });
      }
    }

    this.errorMessage.set(this.describeError(error));
    return undefined;
  }

  private describeError(error: unknown): string {
    const data = readApiErrorData(error) ?? {};
    if (hasApiErrorCode(error, API_ERROR_CODES.PRIVILEGE_ESCALATION)) {
      return this.translate.instant('directory.errors.privilegeEscalation');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_USER_ALREADY_LINKED)) {
      return this.translate.instant('directory.errors.userAlreadyLinked');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_USER_SYSTEM_SCOPED)) {
      return this.translate.instant('directory.errors.systemScoped');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_ALREADY_HAS_USER)) {
      return this.translate.instant('directory.errors.alreadyHasUser', {
        username: typeof data['username'] === 'string' ? data['username'] : '',
      });
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_LINKS_MISSING)) {
      return this.translate.instant('directory.errors.linksMissing');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_IDENTITY_NOT_A_PERSON)) {
      return this.translate.instant('directory.errors.notAPerson');
    }
    return resolveApiErrorMessage(error, this.translate.instant('directory.errors.access'));
  }

  /**
   * Arma el acceso para la persona elegida: con su usuario si ya entra, con el que se venía a vincular, o uno
   * nuevo con el email principal de la ficha. Y trae los roles que sugieren sus vínculos.
   */
  private preparePerson(party: PartyDto): void {
    this.party.set(party);
    this.currentUser.set(null);

    const principalEmail =
      (party.contacts ?? []).find((contact) => contact.type === 'EMAIL' && contact.isPrincipal)
        ?.value ?? '';
    const existing = party.userUuid
      ? { uuid: party.userUuid, name: party.username ?? '' }
      : this.linkingUser
        ? { uuid: this.linkingUser.uuid, name: this.linkingUser.username }
        : null;

    this.model.set(
      grantModel(existing ? '' : principalEmail, {
        existingUserUuid: existing?.uuid ?? '',
        existingUsername: existing?.name ?? '',
      }),
    );

    if (party.userUuid) {
      this.api
        .getUser(party.userUuid)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (user) => {
            this.currentUser.set(user);
            // Lo que ya tiene no se vuelve a proponer, lleguen antes o después los sugeridos.
            const held = new Set(this.currentRoleUuids());
            const roleUuids = this.grantForm.access.roleUuids();
            roleUuids.value.set(roleUuids.value().filter((uuid) => !held.has(uuid)));
          },
          error: () => this.currentUser.set(null),
        });
    }
    this.loadSuggestions(party);
  }

  private loadSuggestions(party: PartyDto): void {
    if (!this.canGrant) {
      this.suggestedState.set('forbidden');
      return;
    }
    this.suggestedState.set('loading');
    this.linksOf(party)
      .pipe(
        switchMap((links) =>
          links.length === 0
            ? of<(SuggestedRoleDto[] | null)[]>([])
            : forkJoin(
                links.map((link) =>
                  this.api
                    .suggestedRoles(link)
                    .pipe(
                      catchError((error: unknown) =>
                        of(error instanceof HttpErrorResponse && error.status === 403 ? null : []),
                      ),
                    ),
                ),
              ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((lists) => {
        const readable = lists.filter((list): list is SuggestedRoleDto[] => list !== null);
        const merged = mergeSuggestedRoles(readable);
        this.suggested.set(merged);
        this.suggestedState.set(lists.length > 0 && readable.length === 0 ? 'forbidden' : 'ready');
        const held = new Set(this.currentRoleUuids());
        this.grantForm.access
          .roleUuids()
          .value.set(initialRoleUuids(merged).filter((uuid) => !held.has(uuid)));
      });
  }

  /** Los vínculos de la persona. Si es empleado, sus especialidades dicen cuáles; si no se pueden leer, ninguno. */
  private linksOf(party: PartyDto): Observable<DirectoryLink[]> {
    const employee = roleOf(party, 'EMPLOYEE');
    if (!employee || !this.auth.hasPermission(Permissions.employeeView)) {
      return of(linksOfParty(party, []));
    }
    return this.api.specialties(employee.uuid).pipe(
      map((rows) =>
        linksOfParty(
          party,
          rows.map((row) => row.specialty),
        ),
      ),
      catchError(() => of(linksOfParty(party, []))),
    );
  }
}
