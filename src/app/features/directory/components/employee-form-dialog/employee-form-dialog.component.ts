import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormField,
  TreeValidationResult,
  form,
  max,
  maxLength,
  min,
  pattern,
  required,
  submit,
  validate,
  applyEach,
} from '@angular/forms/signals';
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
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { VersionConflictService } from '../../../../core/concurrency/version-conflict.service';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { isEmployeeSpecialty } from '../../../../core/parties/directory-links';
import { PartyContactsEditorComponent } from '../../../../core/parties/party-contacts-editor/party-contacts-editor.component';
import { PartyIdentityFieldsComponent } from '../../../../core/parties/party-identity-fields/party-identity-fields.component';
import {
  PARTY_DOC_NUMBER_MAX_LENGTH,
  PARTY_DOC_NUMBER_PATTERN,
  PARTY_NAME_MAX_LENGTH,
  PERSON_DOC_TYPES,
  PartyDocType,
} from '../../../../core/parties/party.model';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { DirectoryApiService } from '../../data-access/directory-api.service';
import { DirectoryCatalogApiService } from '../../data-access/directory-catalog-api.service';
import { AttributeValueModel } from '../../data-access/directory-forms';
import {
  EMPLOYEE_COMMISSION_TYPES,
  EMPLOYEE_CONTRACT_TYPES,
  EmployeeProfileDto,
} from '../../data-access/directory.model';
import { DirectoryAttributeFieldsComponent } from '../directory-attribute-fields/directory-attribute-fields.component';
import {
  EMPLOYEE_FIELD_LIMITS,
  attributeValueError,
} from '../directory-form-dialog/directory-form.schema';
import {
  GrantAccessDialogComponent,
  GrantAccessDialogData,
  GrantAccessDialogResult,
} from '../grant-access-dialog/grant-access-dialog.component';

export interface EmployeeFormDialogData {
  employee: EmployeeProfileDto;
}

export interface EmployeeFormDialogResult {
  kind: 'saved';
  name: string;
  warning?: string;
}

interface EmployeeFormModel {
  name: string;
  docType: PartyDocType | '';
  docNumber: string;
  fileNumber: string;
  dateHired: string;
  branchUuid: string;
  dateTerminated: string;
  contractType: string;
  dateRegisteredTax: string;
  commissionType: string;
  commissionValue: number | null;
  attributes: AttributeValueModel[];
}

/**
 * La ficha general del empleado: lo que ninguna ficha de tipo pregunta. El egreso, la modalidad, el alta
 * fiscal, la comisión general y los campos extra de la empresa son de la persona como empleada, no de una de sus
 * especialidades. **No da de alta**: no hay empleado genérico, y el alta es por tipo.
 *
 * Egresar no es borrar. La fecha de egreso deja al empleado fuera de los listados —se lo ve con «Incluir
 * bajas»— con su legajo, sus especialidades y su historia; borrarlo es para lo que se cargó mal.
 */
@Component({
  selector: 'app-employee-form-dialog',
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
    MatSelectModule,
    TranslatePipe,
    FieldErrorPipe,
    PartyIdentityFieldsComponent,
    PartyContactsEditorComponent,
    DirectoryAttributeFieldsComponent,
  ],
  providers: [DirectoryApiService, DirectoryCatalogApiService],
  templateUrl: './employee-form-dialog.component.html',
  styleUrl: './employee-form-dialog.component.css',
})
export class EmployeeFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<EmployeeFormDialogComponent, EmployeeFormDialogResult>,
  );
  private readonly data = inject<EmployeeFormDialogData>(MAT_DIALOG_DATA);
  private readonly api = inject(DirectoryApiService);
  private readonly catalog = inject(DirectoryCatalogApiService);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly versionConflict = inject(VersionConflictService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly docTypes = PERSON_DOC_TYPES;
  protected readonly contractTypes = EMPLOYEE_CONTRACT_TYPES;
  protected readonly commissionTypes = EMPLOYEE_COMMISSION_TYPES;

  protected readonly employee = signal(this.data.employee);
  protected readonly branches = signal<BranchDto[]>([]);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Si el catálogo de campos extra se pudo leer. Sin él no se reemplaza nada: el reemplazo es del set completo, y
   * mandar la lista vacía le borraría al empleado los valores que tiene.
   */
  private readonly attributesLoaded = signal(false);
  private initialAttributes = '';

  protected readonly model = signal<EmployeeFormModel>(toEmployeeModel(this.data.employee));
  protected readonly employeeForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, PARTY_NAME_MAX_LENGTH);
    maxLength(path.docNumber, PARTY_DOC_NUMBER_MAX_LENGTH);
    pattern(path.docNumber, ({ value }) => (value() ? PARTY_DOC_NUMBER_PATTERN : undefined));
    maxLength(path.fileNumber, EMPLOYEE_FIELD_LIMITS.fileNumber);
    validate(path.dateTerminated, ({ value, valueOf }) => {
      const hired = valueOf(path.dateHired);
      return value() && hired && value() < hired ? { kind: 'terminatedBeforeHired' } : null;
    });
    // La comisión va con su tipo o no va: «las dos cargadas» o «importe sin tipo» son estados que nadie sabe leer.
    required(path.commissionValue, {
      when: ({ valueOf }) =>
        valueOf(path.commissionType) === 'PERCENT' || valueOf(path.commissionType) === 'AMOUNT',
    });
    min(path.commissionValue, 0);
    max(path.commissionValue, ({ valueOf }) =>
      valueOf(path.commissionType) === 'PERCENT' ? 100 : undefined,
    );
    applyEach(path.attributes, (attribute) => {
      validate(attribute.value, ({ value, valueOf }) =>
        attributeValueError(valueOf(attribute.type), value()),
      );
    });
  });

  protected readonly specialties = computed(() =>
    (this.employee().specialties ?? []).filter(isEmployeeSpecialty),
  );
  protected readonly showsCommissionValue = computed(() => {
    const type = this.model().commissionType;
    return type === 'PERCENT' || type === 'AMOUNT';
  });

  protected readonly canManageAccess =
    this.auth.hasPermission(Permissions.partyUserLink) &&
    (this.auth.hasPermission(Permissions.userCreate) ||
      this.auth.hasPermission(Permissions.userEdit));

  ngOnInit(): void {
    this.branchesApi
      .listAvailable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (branches) => this.branches.set(branches),
        error: () => this.branches.set([]),
      });
    this.loadAttributes();
  }

  protected onCommissionTypeChange(): void {
    if (!this.showsCommissionValue()) {
      this.employeeForm.commissionValue().value.set(null);
    }
  }

  protected onManageAccess(): void {
    const current = this.employee();
    if (!current.partyUuid) {
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
      .subscribe(() => {
        this.api
          .getEmployee(current.uuid)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (latest) =>
              this.employee.update((employee) => ({
                ...employee,
                userUuid: latest.userUuid,
                username: latest.username,
                version: latest.version,
              })),
            error: () => undefined,
          });
      });
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    if (this.employeeForm().invalid()) {
      this.employeeForm().markAsTouched();
      return;
    }
    this.errorMessage.set(null);
    void submit(this.employeeForm, async () => {
      this.saving.set(true);
      try {
        return await this.save();
      } finally {
        this.saving.set(false);
      }
    });
  }

  private async save(): Promise<TreeValidationResult> {
    const current = this.employee();
    try {
      const outcome = await firstValueFrom(
        this.versionConflict.saveGuarded<EmployeeProfileDto, EmployeeProfileDto>({
          uuid: current.uuid,
          version: current.version,
          save: (version) =>
            this.api.saveEmployee(employeePayload(this.model(), current.uuid, version)),
          fetchLatest: (uuid) => this.api.getEmployee(uuid),
          label: this.model().name,
          allowCancel: true,
        }),
      );
      if (outcome.kind === 'reloaded') {
        this.employee.set(outcome.latest);
        this.model.set({ ...toEmployeeModel(outcome.latest), attributes: this.model().attributes });
        this.toast.info(this.translate.instant('versionConflict.reloaded'));
        return undefined;
      }
      if (outcome.kind === 'cancelled') {
        return undefined;
      }
      const warning = await this.saveAttributes(current.uuid);
      this.dialogRef.close({ kind: 'saved', name: outcome.value.name, warning });
      return undefined;
    } catch (error) {
      if (hasApiErrorCode(error, API_ERROR_CODES.EMPLOYEE_FILE_NUMBER_DUPLICATE)) {
        return { fieldTree: this.employeeForm.fileNumber, kind: 'fileNumberTaken' };
      }
      this.errorMessage.set(
        resolveApiErrorMessage(error, this.translate.instant('directory.errors.save')),
      );
      return undefined;
    }
  }

  /** Los campos extra van aparte —se reemplaza el set completo— y sólo si cambiaron. */
  private async saveAttributes(employeeUuid: string): Promise<string | undefined> {
    const values = this.model()
      .attributes.filter((attribute) => attribute.value.trim() !== '')
      .map((attribute) => ({
        attributeUuid: attribute.attributeUuid,
        value: attribute.value.trim(),
      }));
    if (!this.attributesLoaded() || JSON.stringify(values) === this.initialAttributes) {
      return undefined;
    }
    try {
      await firstValueFrom(this.api.replaceAttributes(employeeUuid, values));
      return undefined;
    } catch (error) {
      return this.translate.instant('directory.toasts.attributesPending', {
        reason: resolveApiErrorMessage(error, this.translate.instant('directory.errors.save')),
      });
    }
  }

  private loadAttributes(): void {
    if (!this.auth.hasPermission(Permissions.employeeAttributeView)) {
      return;
    }
    const current = new Map(
      (this.data.employee.attributes ?? []).map((attribute) => [
        attribute.attributeUuid,
        attribute.value,
      ]),
    );
    this.catalog
      .employeeAttributes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (catalog) => {
          const attributes = catalog.map((attribute) => ({
            attributeUuid: attribute.uuid,
            name: attribute.name,
            type: attribute.type,
            value: current.get(attribute.uuid) ?? '',
          }));
          this.employeeForm.attributes().value.set(attributes);
          this.initialAttributes = JSON.stringify(
            attributes
              .filter((attribute) => attribute.value.trim() !== '')
              .map((attribute) => ({
                attributeUuid: attribute.attributeUuid,
                value: attribute.value.trim(),
              })),
          );
          this.attributesLoaded.set(true);
        },
        error: () => this.attributesLoaded.set(false),
      });
  }
}

function toEmployeeModel(employee: EmployeeProfileDto): EmployeeFormModel {
  return {
    name: employee.name ?? '',
    docType: employee.docType ?? '',
    docNumber: employee.docNumber ?? '',
    fileNumber: employee.fileNumber ?? '',
    dateHired: employee.dateHired ?? '',
    branchUuid: employee.branch?.uuid ?? '',
    dateTerminated: employee.dateTerminated ?? '',
    contractType: employee.contractType ?? '',
    dateRegisteredTax: employee.dateRegisteredTax ?? '',
    commissionType: employee.commissionType ?? '',
    commissionValue: employee.commissionValue ?? null,
    attributes: [],
  };
}

function employeePayload(
  model: EmployeeFormModel,
  uuid: string,
  version: number | undefined,
): Record<string, unknown> {
  const docNumber = model.docNumber.trim() || null;
  const docType = model.docType || null;
  const commissionType = model.commissionType || null;
  return {
    uuid,
    version,
    name: model.name.trim(),
    docType: docNumber ? docType : null,
    docNumber: docType ? docNumber : null,
    fileNumber: model.fileNumber.trim() || null,
    dateHired: model.dateHired || null,
    branch: model.branchUuid ? { uuid: model.branchUuid } : null,
    dateTerminated: model.dateTerminated || null,
    contractType: model.contractType || null,
    dateRegisteredTax: model.dateRegisteredTax || null,
    commissionType,
    commissionValue:
      commissionType === 'PERCENT' || commissionType === 'AMOUNT' ? model.commissionValue : null,
  };
}
