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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormField, TreeValidationResult, form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
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
import { Observable, catchError, filter, firstValueFrom, map, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { VersionConflictService } from '../../../../core/concurrency/version-conflict.service';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorData,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { UuidNameRef } from '../../../../core/http/api-refs';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PartiesApiService } from '../../../../core/parties/parties-api.service';
import { PartyContactsEditorComponent } from '../../../../core/parties/party-contacts-editor/party-contacts-editor.component';
import { PartyIdentityFieldsComponent } from '../../../../core/parties/party-identity-fields/party-identity-fields.component';
import {
  DirectoryLink,
  DirectoryLinkDetectRequest,
  isEmployeeSpecialty,
} from '../../../../core/parties/directory-links';
import { PartyDto, formatDocument, roleOf } from '../../../../core/parties/party.model';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { DirectoryCatalogApiService } from '../../data-access/directory-catalog-api.service';
import { DirectoryApiService } from '../../data-access/directory-api.service';
import { DirectoryFolderId, folderOfLink } from '../../data-access/directory-folders';
import { DirectoryFormCatalogs } from '../../data-access/directory-form-catalogs';
import {
  DIRECTORY_FORMS,
  DirectoryFormModel,
  ExistingPartyDecision,
  decideExistingParty,
  docTypesOf,
  extraLinkProfiles,
  initialRoleUuids,
  onboardRequest,
  planExtraLinks,
  profilePayload,
  specialtyGrantBody,
  toFormModel,
  userLinkRequest,
} from '../../data-access/directory-forms';
import {
  detectDirectoryLinks,
  sameDetectRequest,
} from '../../data-access/directory-link-detection';
import { DirectoryProfileDto, SuggestedRoleDto } from '../../data-access/directory.model';
import {
  DirectoryAccessBlockComponent,
  SuggestedRolesState,
} from '../directory-access-block/directory-access-block.component';
import { DirectoryAttributeFieldsComponent } from '../directory-attribute-fields/directory-attribute-fields.component';
import { DirectoryExistingPartyComponent } from '../directory-existing-party/directory-existing-party.component';
import { DirectoryExtraLinksComponent } from '../directory-extra-links/directory-extra-links.component';
import { DirectoryProfileFieldsComponent } from '../directory-profile-fields/directory-profile-fields.component';
import {
  GrantAccessDialogComponent,
  GrantAccessDialogData,
  GrantAccessDialogResult,
} from '../grant-access-dialog/grant-access-dialog.component';
import { directoryFormSchema } from './directory-form.schema';

export interface DirectoryFormDialogData {
  link: DirectoryLink;
  /** La ficha a editar; `null` en un alta. */
  profile: DirectoryProfileDto | null;
}

/** Una ficha del directorio a la que se puede ir: la de una carpeta de vínculo, o la general del empleado. */
export interface DirectoryRecordRef {
  folder: DirectoryFolderId;
  uuid: string;
}

/**
 * Cómo cierra el formulario:
 * - `saved`: se dio de alta, se le sumó el vínculo a alguien que ya estaba, o se guardó la edición. `warning`
 *   dice lo que no se pudo hacer en el mismo paso —el acceso de una especialidad sumada, por ejemplo—.
 * - `open`: el documento ya tenía este vínculo, y el operador pidió ver esa ficha.
 */
export type DirectoryFormDialogResult =
  | { kind: 'saved'; created: boolean; linkAdded: boolean; name: string; warning?: string }
  | { kind: 'open'; record: DirectoryRecordRef };

/** En qué está el alta: una ficha nueva, o sumarle el vínculo a una que ya existe. */
type OnboardMode = 'create' | 'addLink' | 'addSpecialty';

/**
 * El alta y la edición de un vínculo del directorio: cliente, proveedor o uno de los tres tipos de empleado.
 *
 * **El tipo es la carpeta desde la que se abrió**, y el formulario pide exactamente lo suyo: la identidad que le
 * corresponde, los campos de su ABM y el bloque de acceso, opcional en el tercero y obligatorio en el empleado.
 *
 * **Salvo lo que piden los roles.** Lo que una persona es sale de lo que puede hacer: si los roles que se le dan
 * la hacen ser otro vínculo —el cliente con un rol de reparto es transportista—, el formulario lo detecta con el
 * backend y pide también los datos de ése. Son obligatorios: el alta los crea en la misma transacción, y sin
 * ellos no guarda nada.
 *
 * El alta va por el alta compuesta del tipo, en una transacción: la ficha, el contacto, los campos extra y el
 * usuario entran juntos o no entra nada. Cuando el documento ya está cargado, el alta no crea otra ficha: le suma
 * el vínculo a la que existe —o la especialidad, si ya es empleado— y pide sólo los campos de ese vínculo.
 *
 * El formulario guarda por su cuenta en vez de devolverle el pedido a la página: los rechazos del alta —el nombre
 * de usuario tomado, el legajo repetido, un rol que quien carga no puede otorgar— se resuelven mirando lo que se
 * tipeó, y con el formulario cerrado no habría dónde.
 */
@Component({
  selector: 'app-directory-form-dialog',
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
    PartyIdentityFieldsComponent,
    PartyContactsEditorComponent,
    DirectoryAccessBlockComponent,
    DirectoryAttributeFieldsComponent,
    DirectoryExistingPartyComponent,
    DirectoryExtraLinksComponent,
    DirectoryProfileFieldsComponent,
  ],
  providers: [DirectoryApiService, DirectoryCatalogApiService, DirectoryFormCatalogs],
  templateUrl: './directory-form-dialog.component.html',
  styleUrl: './directory-form-dialog.component.css',
})
export class DirectoryFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<DirectoryFormDialogComponent, DirectoryFormDialogResult>,
  );
  private readonly data = inject<DirectoryFormDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(DirectoryApiService);
  private readonly catalog = inject(DirectoryCatalogApiService);
  private readonly partiesApi = inject(PartiesApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly link = this.data.link;
  protected readonly definition = DIRECTORY_FORMS[this.link];
  protected readonly isEdit = this.data.profile !== null;
  protected readonly isEmployee = isEmployeeSpecialty(this.link);
  protected readonly docTypes = docTypesOf(this.definition);

  /** La ficha que se edita, con su versión vigente: se reemplaza si el guardado choca y se recarga. */
  protected readonly profile = signal(this.data.profile);

  protected readonly model = signal<DirectoryFormModel>(toFormModel(this.link, this.data.profile));
  protected readonly profileForm = form(this.model, directoryFormSchema);

  protected readonly mode = signal<OnboardMode>('create');
  protected readonly existing = signal<ExistingPartyDecision | null>(null);
  protected readonly lookingUp = signal(false);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly takenUser = signal<UuidNameRef | null>(null);

  protected readonly catalogs = inject(DirectoryFormCatalogs);
  protected readonly suggestedRoles = signal<SuggestedRoleDto[]>([]);
  protected readonly suggestedState = signal<SuggestedRolesState>('loading');
  protected readonly roles = signal<UuidNameRef[]>([]);

  /** Dar acceso pide `party.user_link` y el permiso de usuarios: sin ellos, un empleado no se puede dar de alta. */
  protected readonly canGrantAccess =
    this.auth.hasPermission(Permissions.partyUserLink) &&
    (this.auth.hasPermission(Permissions.userCreate) ||
      this.auth.hasPermission(Permissions.userEdit));

  /** La persona ya cargada a la que se le suma el vínculo, una vez que el operador lo eligió. */
  protected readonly chosenParty = computed<PartyDto | null>(() =>
    this.mode() === 'create' ? null : (this.existing()?.party ?? null),
  );

  protected readonly chosenDocument = computed(() => {
    const party = this.chosenParty();
    return party?.docNumber ? formatDocument(party) : null;
  });

  /**
   * Qué se mide para saber qué vínculos piden los roles: los que se le dan, los que ya tiene su usuario si entra
   * con uno que existe, y la ficha si ya está cargada. Sin acceso no hay roles, y no hay nada que medir.
   */
  private readonly detectRequest = computed<DirectoryLinkDetectRequest | null>(
    () => {
      const access = this.model().access;
      if (
        this.isEdit ||
        !this.canGrantAccess ||
        !access.enabled ||
        (access.roleUuids.length === 0 && !access.existingUserUuid)
      ) {
        return null;
      }
      return {
        roleUuids: access.roleUuids,
        partyUuid: this.chosenParty()?.uuid ?? null,
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

  /** La persona ya es empleado: el legajo, el ingreso y la sucursal no se vuelven a pedir. */
  private readonly personIsEmployee = computed(() => {
    if (this.mode() === 'addSpecialty') {
      return true;
    }
    const party = this.chosenParty();
    return !!party && !!roleOf(party, 'EMPLOYEE');
  });

  /** Los vínculos que piden los roles además del de la carpeta, con sus datos obligatorios. */
  protected readonly extraLinks = computed(() =>
    planExtraLinks(
      this.detection().detected,
      this.missingLinks(),
      this.link,
      this.personIsEmployee(),
    ),
  );

  protected readonly submitBlocked = computed(
    () =>
      this.saving() ||
      this.lookingUp() ||
      // Hasta saber qué vínculos piden los roles, no se sabe qué datos faltan.
      this.detection().status === 'loading' ||
      // El documento es de una ficha que ya existe y el operador todavía no eligió qué hacer.
      (this.mode() === 'create' && this.existing() !== null) ||
      (!this.isEdit && this.definition.access === 'required' && !this.canGrantAccess),
  );

  protected readonly submitLabelKey = computed(() => {
    if (this.isEdit) {
      return 'directory.form.save';
    }
    return this.mode() === 'create'
      ? `directory.form.create.${this.link}`
      : 'directory.form.addLinkSubmit';
  });

  /** El documento que ya se buscó: salir del campo sin cambiarlo no vuelve a preguntar. */
  private lastLookup = '';

  constructor() {
    // Los selects del vínculo de la carpeta y los de cada vínculo que sumen los roles, cuando aparece.
    effect(() => this.catalogs.requireFor([this.link, ...this.extraLinks().links]));
  }

  ngOnInit(): void {
    if (!this.isEdit) {
      this.loadAttributes();
      this.loadRoles();
    }
  }

  /**
   * Busca el documento sobre **todo** el maestro, no sólo en esta carpeta: si buscara sólo entre transportistas,
   * el cliente que además hay que dar de alta como transportista volvería como un 409 sobre una ficha que el
   * operador no puede abrir desde acá.
   */
  protected onDocumentBlur(): void {
    if (this.isEdit || this.mode() !== 'create') {
      return;
    }
    const { docType, docNumber } = this.model();
    const trimmed = docNumber.trim();
    const key = `${docType}|${trimmed}`;
    if (key === this.lastLookup) {
      return;
    }
    this.lastLookup = key;
    if (!docType || !trimmed) {
      this.existing.set(null);
      return;
    }

    this.lookingUp.set(true);
    this.partiesApi
      .searchByDocument(docType, trimmed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (parties) => {
          if (parties.length === 0) {
            this.existing.set(null);
            this.lookingUp.set(false);
            return;
          }
          this.showDecisionFor(parties[0]);
        },
        error: () => {
          // Quien carga empleados no siempre puede leer el maestro. Que la búsqueda falle no bloquea el alta: si
          // el documento está repetido, el backend responde 409 al guardar y el formulario lo resuelve ahí.
          this.existing.set(null);
          this.lookingUp.set(false);
        },
      });
  }

  /**
   * Sumarle el vínculo a la ficha que ya existe. La identidad queda como estaba: el formulario la muestra y deja
   * de pedirla, y si la persona ya entra al sistema, el acceso le suma roles a su usuario en vez de crear otro.
   */
  protected onAcceptExisting(): void {
    const decision = this.existing();
    if (!decision || decision.kind === 'open') {
      return;
    }
    const party = decision.party;
    this.mode.set(decision.kind);
    this.errorMessage.set(null);
    this.model.update((model) => ({
      ...model,
      name: party.name || model.name,
      docType: party.docType ?? model.docType,
      docNumber: party.docNumber ?? model.docNumber,
      email: '',
      access: party.userUuid
        ? {
            ...model.access,
            existingUserUuid: party.userUuid,
            existingUsername: party.username ?? '',
            username: '',
            password: '',
          }
        : model.access,
    }));
  }

  protected onOpenExisting(): void {
    const record = this.existingRecord();
    if (record) {
      this.dialogRef.close({ kind: 'open', record });
    }
  }

  /** Elegir otra persona: vuelve al alta de una ficha nueva, con el documento en blanco. */
  protected onResetExisting(): void {
    this.mode.set('create');
    this.existing.set(null);
    this.lastLookup = '';
    this.model.update((model) => ({
      ...model,
      docType: '',
      docNumber: '',
      access: { ...model.access, existingUserUuid: '', existingUsername: '' },
    }));
  }

  /** El acceso de una ficha que se edita: se da o se revisa en su propio diálogo, sin perder lo tipeado acá. */
  protected onManageAccess(): void {
    const current = this.profile();
    if (!current?.partyUuid) {
      return;
    }
    this.dialog
      .open<GrantAccessDialogComponent, GrantAccessDialogData, GrantAccessDialogResult>(
        GrantAccessDialogComponent,
        {
          width: '40rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data: {
            party: {
              uuid: current.partyUuid,
              name: current.name,
              docType: current.docType,
              docNumber: current.docNumber,
              userUuid: current.userUuid,
              username: current.username,
              roles: [],
            },
          },
        },
      )
      .afterClosed()
      .pipe(
        filter((result): result is GrantAccessDialogResult => !!result),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.refreshUser(current));
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.submitBlocked()) {
      return;
    }
    if (this.profileForm().invalid()) {
      this.profileForm().markAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.takenUser.set(null);
    void submit(this.profileForm, async () => {
      this.saving.set(true);
      try {
        if (this.isEdit) {
          return await this.saveEdit();
        }
        return this.mode() === 'addSpecialty' ? await this.grantSpecialty() : await this.onboard();
      } finally {
        this.saving.set(false);
      }
    });
  }

  private async onboard(): Promise<TreeValidationResult> {
    const decision = this.existing();
    const partyUuid = this.mode() === 'addLink' && decision ? decision.party.uuid : null;
    try {
      const saved = await firstValueFrom(
        this.api.onboard(
          this.link,
          onboardRequest(this.link, this.model(), partyUuid, this.extraLinks()),
        ),
      );
      this.dialogRef.close({
        kind: 'saved',
        created: true,
        linkAdded: partyUuid !== null,
        name: saved.name,
      });
      return undefined;
    } catch (error) {
      return this.onSaveError(error);
    }
  }

  /**
   * Le suma la especialidad a alguien que ya es empleado. No pasa por el alta compuesta —el empleado ya existe—,
   * así que el acceso va en un segundo paso: si ése falla, la especialidad ya quedó otorgada y el cierre lo dice.
   */
  private async grantSpecialty(): Promise<TreeValidationResult> {
    const decision = this.existing();
    if (!decision || decision.kind !== 'addSpecialty') {
      return undefined;
    }
    try {
      await firstValueFrom(
        this.api.grantSpecialty(decision.employeeUuid, specialtyGrantBody(this.link, this.model())),
      );
    } catch (error) {
      return this.onSaveError(error);
    }

    const warning = await this.linkUserAfterGrant(decision.party);
    this.dialogRef.close({
      kind: 'saved',
      created: true,
      linkAdded: true,
      name: decision.party.name || this.model().name,
      warning,
    });
    return undefined;
  }

  private async linkUserAfterGrant(party: PartyDto): Promise<string | undefined> {
    const links = extraLinkProfiles(this.extraLinks(), this.model());
    const request = userLinkRequest(this.model().access, '', links);
    if (
      !request ||
      ('userUuid' in request && request.roleUuids.length === 0 && links.length === 0)
    ) {
      return undefined;
    }
    try {
      await firstValueFrom(this.partiesApi.linkUser(party.uuid, request));
      return undefined;
    } catch (error) {
      return this.translate.instant('directory.toasts.accessPending', {
        name: party.name || this.model().name,
        reason: this.describeError(error),
      });
    }
  }

  private async saveEdit(): Promise<TreeValidationResult> {
    const current = this.profile();
    if (!current) {
      return undefined;
    }
    try {
      const outcome = await firstValueFrom(
        this.versionConflict.saveGuarded<DirectoryProfileDto, DirectoryProfileDto>({
          uuid: current.uuid,
          version: current.version,
          save: (version) =>
            this.api.saveProfile(
              this.link,
              profilePayload(this.link, this.model(), { uuid: current.uuid, version }),
            ),
          fetchLatest: (uuid) => this.api.getProfile(this.link, uuid),
          label: this.model().name,
          allowCancel: true,
        }),
      );
      if (outcome.kind === 'saved') {
        this.dialogRef.close({
          kind: 'saved',
          created: false,
          linkAdded: false,
          name: outcome.value.name,
        });
      } else if (outcome.kind === 'reloaded') {
        this.profile.set(outcome.latest);
        this.model.set(toFormModel(this.link, outcome.latest));
        this.toast.info(this.translate.instant('versionConflict.reloaded'));
      }
      return undefined;
    } catch (error) {
      return this.onSaveError(error);
    }
  }

  /**
   * Los rechazos que se resuelven en el formulario. Los «ya existe» del documento no son errores: vuelven a
   * preguntar qué hacer con la ficha que ya está. Los de un campo se muestran en el campo; el resto, arriba.
   */
  private async onSaveError(error: unknown): Promise<TreeValidationResult> {
    const data = readApiErrorData(error) ?? {};

    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_DOCUMENT_ALREADY_EXISTS)) {
      const partyUuid = data['partyUuid'];
      if (typeof partyUuid === 'string') {
        await this.showExistingParty(partyUuid);
        return undefined;
      }
    }

    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_ROLE_ALREADY_EXISTS)) {
      const partyUuid = data['partyUuid'];
      const roleUuid = data['partyRoleUuid'];
      if (typeof partyUuid === 'string' && typeof roleUuid === 'string') {
        await this.showExistingRole(partyUuid, roleUuid);
        return undefined;
      }
    }

    if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_FILE_NUMBER_DUPLICATE)) {
      return { fieldTree: this.profileForm.fileNumber, kind: 'fileNumberTaken' };
    }

    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_USER_ALREADY_EXISTS)) {
      const userUuid = data['userUuid'];
      this.takenUser.set(
        typeof userUuid === 'string'
          ? { uuid: userUuid, name: this.model().access.username.trim() }
          : null,
      );
      return { fieldTree: this.profileForm.access.username, kind: 'usernameTaken' };
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
    if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_USER_REQUIRED)) {
      return this.translate.instant('directory.errors.employeeUserRequired');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.PARTY_LINKS_MISSING)) {
      return this.translate.instant('directory.errors.linksMissing');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_IDENTITY_NOT_A_PERSON)) {
      return this.translate.instant('directory.errors.notAPerson');
    }
    return resolveApiErrorMessage(error, this.translate.instant('directory.errors.save'));
  }

  /** El documento es de otra ficha: se lee para poder nombrarla, y si no se puede, se ofrece igual el vínculo. */
  private async showExistingParty(partyUuid: string): Promise<void> {
    const party = await firstValueFrom(this.readParty(partyUuid));
    const decision = await firstValueFrom(this.decide(party));
    this.mode.set('create');
    this.existing.set(decision);
  }

  /**
   * La ficha ya tiene el rol. En cliente y proveedor es un duplicado de verdad; en un empleado, falta saber si
   * tiene **esta** especialidad o sólo otra.
   */
  private async showExistingRole(partyUuid: string, roleUuid: string): Promise<void> {
    const known = this.existing()?.party;
    const party =
      known?.uuid === partyUuid ? known : await firstValueFrom(this.readParty(partyUuid));

    let decision: ExistingPartyDecision = { kind: 'open', party, recordUuid: roleUuid };
    if (this.isEmployee) {
      const specialties = await firstValueFrom(
        this.api.specialties(roleUuid).pipe(
          map((rows) => rows.map((row) => row.specialty)),
          catchError(() => of<string[]>([])),
        ),
      );
      decision = specialties.includes(this.link)
        ? { kind: 'open', party, recordUuid: roleUuid }
        : { kind: 'addSpecialty', party, employeeUuid: roleUuid, specialties };
    }
    this.mode.set('create');
    this.existing.set(decision);
  }

  private showDecisionFor(party: PartyDto): void {
    this.decide(party)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (decision) => {
          this.existing.set(decision);
          this.lookingUp.set(false);
        },
        error: () => {
          this.existing.set(decideExistingParty(this.link, party));
          this.lookingUp.set(false);
        },
      });
  }

  private decide(party: PartyDto): Observable<ExistingPartyDecision> {
    const employee = roleOf(party, 'EMPLOYEE');
    if (!this.isEmployee || !employee) {
      return of(decideExistingParty(this.link, party));
    }
    return this.api.specialties(employee.uuid).pipe(
      map((rows) =>
        decideExistingParty(
          this.link,
          party,
          rows.map((row) => row.specialty),
        ),
      ),
    );
  }

  /** La ficha del maestro, o lo mínimo para ofrecer el vínculo si quien carga no puede leerla. */
  private readParty(partyUuid: string): Observable<PartyDto> {
    return this.partiesApi
      .getByUuid(partyUuid)
      .pipe(catchError(() => of<PartyDto>({ uuid: partyUuid, name: '', roles: [] })));
  }

  private existingRecord(): DirectoryRecordRef | null {
    const decision = this.existing();
    if (!decision) {
      return null;
    }
    if (decision.kind === 'open') {
      return { folder: folderOfLink(this.link), uuid: decision.recordUuid };
    }
    if (decision.kind === 'addSpecialty') {
      return { folder: 'employees', uuid: decision.employeeUuid };
    }
    const role = (decision.party.roles ?? [])[0];
    if (!role) {
      return null;
    }
    const folders = {
      CUSTOMER: 'customers',
      SUPPLIER: 'suppliers',
      EMPLOYEE: 'employees',
    } as const;
    return { folder: folders[role.role], uuid: role.uuid };
  }

  private loadAttributes(): void {
    if (!this.isEmployee || !this.auth.hasPermission(Permissions.employeeAttributeView)) {
      return;
    }
    this.catalog
      .employeeAttributes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (attributes) =>
          this.profileForm.attributes().value.set(
            attributes.map((attribute) => ({
              attributeUuid: attribute.uuid,
              name: attribute.name,
              type: attribute.type,
              value: '',
            })),
          ),
        error: () => this.profileForm.attributes().value.set([]),
      });
  }

  /**
   * Los roles del bloque de acceso. Los sugeridos llegan elegidos si son los de sistema del vínculo y quien carga
   * los puede otorgar; el resto de los roles de la empresa se ofrece al agregar, si quien carga puede verlos.
   */
  private loadRoles(): void {
    if (!this.canGrantAccess) {
      this.suggestedState.set('forbidden');
      return;
    }
    this.api
      .suggestedRoles(this.link)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (roles) => {
          this.suggestedRoles.set(roles);
          this.suggestedState.set('ready');
          if (this.model().access.roleUuids.length === 0) {
            this.profileForm.access.roleUuids().value.set(initialRoleUuids(roles));
          }
        },
        error: (error: unknown) =>
          this.suggestedState.set(
            error instanceof HttpErrorResponse && error.status === 403 ? 'forbidden' : 'error',
          ),
      });

    if (this.auth.hasPermission(Permissions.roleView)) {
      this.catalog
        .roles()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (roles) => this.roles.set(roles), error: () => this.roles.set([]) });
    }
  }

  /** Relee la ficha editada para mostrar el usuario que le quedó, sin tocar lo que se estaba editando. */
  private refreshUser(current: DirectoryProfileDto): void {
    this.api
      .getProfile(this.link, current.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (latest) =>
          this.profile.update((profile) =>
            profile
              ? {
                  ...profile,
                  userUuid: latest.userUuid,
                  username: latest.username,
                  version: latest.version,
                }
              : profile,
          ),
        error: () => undefined,
      });
  }
}
