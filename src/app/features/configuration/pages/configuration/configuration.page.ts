import { Component, DestroyRef, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FieldTree, form, submit } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { BranchDto } from '../../../../core/branch/branch.model';
import { BranchesApiService } from '../../../../core/branch/branches-api.service';
import { ConfigurationApiService } from '../../../../core/configuration/configuration-api.service';
import { ConfigurationStore } from '../../../../core/configuration/configuration.store';
import {
  CONFIGURATION_GROUPS,
  CONFIGURATION_KEYS,
  ConfigurationGroup,
  ConfigurationLevel,
  ConfigurationScope,
  EffectiveSettingDto,
  SettingDefinitionDto,
  allowsLevel,
  isConfigurationScope,
  settingGroup,
} from '../../../../core/configuration/configuration.model';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import {
  API_ERROR_CODES,
  hasApiErrorCode,
  readApiErrorData,
  resolveApiErrorMessage,
} from '../../../../core/http/api-error.model';
import { ToastService } from '../../../../core/notifications/toast.service';
import { Permissions } from '../../../../core/auth/permissions';
import {
  HasUnsavedChanges,
  trackUnsavedChanges,
} from '../../../../core/unsaved-changes/unsaved-changes.tracker';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { SettingFieldComponent } from '../../components/setting-field/setting-field.component';
import {
  SettingsFormModel,
  SettingsFormState,
  buildFormState,
  buildSavePayloads,
} from '../../data-access/configuration-form.model';
import { settingsSchema } from '../../data-access/configuration-form.schema';

/** Los niveles que el selector ofrece. `GLOBAL` no está: es de las claves de sistema. */
const EDITABLE_LEVELS = ['COMPANY', 'BRANCH', 'USER'] as const;

type EditableLevel = (typeof EDITABLE_LEVELS)[number];

/**
 * Los parámetros con los que opera el sistema, en una sola pantalla que **se dibuja desde el
 * catálogo** y no conoce ninguna clave.
 *
 * `GET /configuration/definitions` dice qué claves hay, de qué tipo es cada valor, con qué
 * restricciones, cuál es su valor por defecto y en qué niveles se puede pisar;
 * `GET /configuration/effective?levels=true` dice qué rige hoy y de qué peldaño salió. De ahí salen
 * las solapas, los controles, los chips de origen y el hint de «Restablecer». Una clave nueva de un
 * tipo ya conocido aparece acá sola, con dos claves de i18n y sin tocar este archivo.
 *
 * Tres decisiones que se ven en la pantalla y conviene no deshacer:
 *
 * - **El nivel se elige con un `mat-select`**, no con un `mat-button-toggle-group`: el grupo emite
 *   `valueChange` al iniciarse y dejaría el nivel en blanco antes de que nadie lo toque.
 * - **Se guarda de a una solapa y es atómico** (RN-13). El contador de cambios pendientes es lo que
 *   hace entendible que «Guardar» mande varias claves de una.
 * - **Sólo se mandan las claves que cambiaron.** Mandar la solapa entera crearía una fila propia por
 *   cada clave que alguien miró sin tocar, y esa sucursal dejaría de heredar de su empresa sin que
 *   nadie lo haya decidido.
 */
@Component({
  selector: 'app-configuration-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
    SettingFieldComponent,
  ],
  templateUrl: './configuration.page.html',
  styleUrl: './configuration.page.css',
})
export class ConfigurationPage implements OnInit, HasUnsavedChanges {
  private readonly api = inject(ConfigurationApiService);
  private readonly store = inject(ConfigurationStore);
  private readonly branchesApi = inject(BranchesApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly levels = EDITABLE_LEVELS;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  private readonly definitions = signal<readonly SettingDefinitionDto[]>([]);
  private readonly effective = signal<readonly EffectiveSettingDto[]>([]);

  /** El nivel que se está editando. Las claves de sistema no lo miran: viven en la instancia. */
  protected readonly level = signal<EditableLevel>('COMPANY');
  protected readonly branches = signal<readonly BranchDto[]>([]);
  protected readonly selectedBranchUuid = signal<string | null>(null);

  protected readonly model = signal<SettingsFormModel>({});

  /** Claves con fila propia en el nivel elegido. Es lo que decide si el guardado crea o borra. */
  private readonly overridden = signal<ReadonlySet<string>>(new Set());

  /** Cómo se abrió la pantalla. Lo que cambió respecto de esto es lo único que viaja. */
  private readonly initial = signal<SettingsFormState>(emptyState());

  private readonly changes = trackUnsavedChanges(this.model);

  /** Público, sin `protected`: lo lee `unsavedChangesGuard` desde afuera del componente. */
  readonly hasUnsavedChanges = this.changes.hasUnsavedChanges;

  /**
   * El formulario se arma **después** de que llega el catálogo: el esquema se genera desde las
   * definiciones —un validador por clave— y un formulario creado antes no tendría ninguno.
   */
  protected readonly settingsForm = signal<FieldTree<SettingsFormModel> | null>(null);

  protected readonly canEdit = computed(() => this.auth.hasPermission(Permissions.configurationEdit));


  /** Solapas: los grupos que tienen al menos una clave visible para este usuario. */
  protected readonly groups = computed<ConfigurationGroup[]>(() => {
    const present = new Set(this.definitions().map((definition) => settingGroup(definition)));
    return CONFIGURATION_GROUPS.filter((group) => present.has(group));
  });

  protected readonly selectedTab = signal(0);

  protected readonly activeGroup = computed<ConfigurationGroup | null>(
    () => this.groups()[this.selectedTab()] ?? null,
  );

  /** El nombre de la empresa o de la sucursal que se está editando, para el texto de contexto. */
  protected readonly contextName = computed(() => {
    if (this.level() === 'BRANCH') {
      const uuid = this.selectedBranchUuid();
      return this.branches().find((branch) => branch.uuid === uuid)?.name ?? '';
    }
    if (this.level() === 'USER') {
      return this.auth.authUser()?.username ?? '';
    }
    return this.companyName();
  });

  protected readonly companyName = computed(
    () =>
      this.auth
        .companies()
        .find((company) => company.companyUuid === this.auth.selectedCompanyUuid())?.companyName ??
      '',
  );

  protected readonly definitionsOf = computed(() => {
    const group = this.activeGroup();
    return group ? this.definitions().filter((d) => settingGroup(d) === group) : [];
  });

  /** Cuántas claves de la solapa activa se guardarían. Es el contador de la barra de abajo. */
  protected readonly pendingChanges = computed(
    () => this.payloadsFor(this.activeGroup()).length,
  );

  /**
   * Ninguna clave admite todavía el nivel usuario. Se dice explícito en vez de esconder la opción:
   * el nivel existe en el modelo, y quien lo busque tiene que encontrar por qué está vacío.
   */
  protected readonly userLevelEmpty = computed(
    () =>
      this.level() === 'USER' &&
      !this.definitions().some((definition) => allowsLevel(definition, 'USER')),
  );

  ngOnInit(): void {
    this.selectedBranchUuid.set(this.auth.selectedBranchUuid());
    this.loadBranches();
    this.reload();
  }

  protected onLevelChange(level: EditableLevel): void {
    this.level.set(level);
    if (level === 'BRANCH' && !this.selectedBranchUuid()) {
      this.selectedBranchUuid.set(this.auth.selectedBranchUuid());
    }
    this.reload();
  }

  protected onBranchChange(uuid: string): void {
    this.selectedBranchUuid.set(uuid);
    this.reload();
  }

  protected onTabChange(index: number): void {
    this.selectedTab.set(index);
  }

  /** Qué nivel gobierna una clave: las de sistema, la instancia; el resto, el del selector. */
  protected levelOf(definition: SettingDefinitionDto): ConfigurationLevel {
    return settingGroup(definition) === 'system' ? 'GLOBAL' : this.level();
  }

  /**
   * De qué peldaño sale el valor que muestra el campo.
   *
   * Una clave recién pisada en pantalla responde **el nivel que se está editando**, aunque el
   * servidor todavía diga otro: si no, el chip diría «Por defecto» al lado de un «Restablecer», que
   * es una contradicción. El chip y el botón cuentan la misma historia, la de lo que se va a
   * guardar.
   */
  protected sourceOf(key: string): ConfigurationScope {
    if (this.overridden().has(key)) {
      const definition = this.definitions().find((candidate) => candidate.key === key);
      return definition ? this.levelOf(definition) : 'DEFAULT';
    }

    const source = this.effective().find((setting) => setting.key === key)?.source;
    return source && isConfigurationScope(source) ? source : 'DEFAULT';
  }

  protected levelsOf(key: string): Partial<Record<ConfigurationLevel, string | null>> | null {
    return this.effective().find((setting) => setting.key === key)?.levels ?? null;
  }

  protected isOverridden(key: string): boolean {
    return this.overridden().has(key);
  }

  protected inheritedValue(key: string): string | null {
    return this.initial().inherited[key] ?? null;
  }

  /** Una escritura marca la clave como pisada en este nivel: es lo que crea la fila al guardar. */
  protected onFieldChanged(key: string): void {
    this.overridden.update((keys) => new Set(keys).add(key));
  }

  /** «Restablecer»: se borra la fila propia y el campo vuelve a mostrar lo que se hereda. */
  protected onFieldReset(key: string): void {
    this.model.update((model) => ({ ...model, [key]: this.inheritedValue(key) }));
    this.overridden.update((keys) => {
      const next = new Set(keys);
      next.delete(key);
      return next;
    });
  }

  protected onDiscard(): void {
    const initial = this.initial();
    this.model.set({ ...initial.model });
    this.overridden.set(new Set(initial.overridden));
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    const settingsForm = this.settingsForm();
    const group = this.activeGroup();
    if (!settingsForm || !group) {
      return;
    }

    if (settingsForm().invalid()) {
      settingsForm().markAsTouched();
      this.selectedTab.set(this.firstInvalidTab());
      return;
    }

    const payloads = this.payloadsFor(group);
    if (payloads.length === 0) {
      return;
    }

    void submit(settingsForm, async () => {
      if (!(await this.confirmSideEffects(payloads.map((payload) => payload.key)))) {
        return undefined;
      }

      this.saving.set(true);
      try {
        await firstValueFrom(this.api.saveList(payloads));
      } catch (error) {
        this.reportSaveError(error);
        return undefined;
      } finally {
        this.saving.set(false);
      }

      this.toast.success(
        this.translate.instant('configuration.toasts.saved', { context: this.contextName() }),
      );
      this.toast.info(this.translate.instant('configuration.toasts.cacheDelay'));

      // El resto de la aplicación tiene su propio snapshot: si lo que se editó es el contexto
      // activo, se lo hace releer para que el punto de venta no siga con el valor anterior.
      if (this.editsActiveContext()) {
        this.store.reload().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
      }

      this.reload();
      return undefined;
    });
  }

  /**
   * Los cambios de la solapa pedida. Se calcula en cada lectura y no se guarda: es barato —una
   * decena de claves— y así el contador nunca se desincroniza del formulario.
   */
  private payloadsFor(group: ConfigurationGroup | null) {
    if (!group) {
      return [];
    }

    const definitions = this.definitions().filter((d) => settingGroup(d) === group);
    if (definitions.length === 0) {
      return [];
    }

    const current: SettingsFormState = {
      model: this.model(),
      overridden: this.overridden(),
      inherited: this.initial().inherited,
    };

    return buildSavePayloads(definitions, this.initial(), current, this.target(group));
  }

  private target(group: ConfigurationGroup) {
    if (group === 'system') {
      return { level: 'GLOBAL' as ConfigurationLevel };
    }

    switch (this.level()) {
      case 'BRANCH':
        return {
          level: 'BRANCH' as ConfigurationLevel,
          branchUuid: this.selectedBranchUuid() ?? undefined,
        };
      case 'USER':
        return {
          level: 'USER' as ConfigurationLevel,
          userUuid: this.auth.authUser()?.uuid ?? undefined,
        };
      default:
        return {
          level: 'COMPANY' as ConfigurationLevel,
          companyUuid: this.auth.selectedCompanyUuid() ?? undefined,
        };
    }
  }

  /**
   * El único cambio de v1 con un efecto que vale la pena confirmar: pasar una sucursal a otro método
   * de costeo recalcula el costo de todo su catálogo, dentro de la misma transacción del guardado.
   */
  private async confirmSideEffects(keys: readonly string[]): Promise<boolean> {
    if (this.level() !== 'BRANCH' || !keys.includes(CONFIGURATION_KEYS.purchaseCostMethod)) {
      return true;
    }

    return firstValueFrom(
      this.confirmDialog.confirm({
        title: this.translate.instant('configuration.recost.title'),
        message: this.translate.instant('configuration.recost.message', {
          branch: this.contextName(),
        }),
        confirmLabel: this.translate.instant('configuration.recost.confirm'),
        confirmColor: 'primary',
      }),
    );
  }

  private reportSaveError(error: unknown): void {
    if (hasApiErrorCode(error, API_ERROR_CODES.CONFIGURATION_VALUE_INVALID)) {
      const key = readApiErrorData(error)?.['key'];
      if (typeof key === 'string') {
        this.selectedTab.set(this.tabOf(key));
      }
    }

    this.toast.error(
      resolveApiErrorMessage(error, this.translate.instant('configuration.toasts.saveFailed')),
    );
  }

  /** La solapa a la que rebota un submit inválido: la primera con un error. */
  private firstInvalidTab(): number {
    const settingsForm = this.settingsForm();
    if (!settingsForm) {
      return this.selectedTab();
    }

    const invalid = this.definitions().find((definition) => {
      const field = settingsForm[definition.key] as FieldTree<string | null> | undefined;
      return field?.().invalid() ?? false;
    });

    return invalid ? this.tabOf(invalid.key) : this.selectedTab();
  }

  private tabOf(key: string): number {
    const definition = this.definitions().find((candidate) => candidate.key === key);
    if (!definition) {
      return this.selectedTab();
    }
    const index = this.groups().indexOf(settingGroup(definition));
    return index >= 0 ? index : this.selectedTab();
  }

  /** `true` cuando lo que se está editando es el contexto con el que opera este tab. */
  private editsActiveContext(): boolean {
    return (
      this.level() === 'COMPANY' ||
      (this.level() === 'BRANCH' && this.selectedBranchUuid() === this.auth.selectedBranchUuid())
    );
  }

  private loadBranches(): void {
    this.branchesApi
      .listAll()
      .pipe(catchError(() => of([] as BranchDto[])))
      .subscribe((branches) => this.branches.set(branches.filter((branch) => branch.active)));
  }

  private reload(): void {
    this.loading.set(true);

    const branchUuid =
      this.level() === 'BRANCH' && this.selectedBranchUuid() !== this.auth.selectedBranchUuid()
        ? (this.selectedBranchUuid() ?? undefined)
        : undefined;

    forkJoin({
      definitions: this.api.definitions().pipe(catchError(() => of([] as SettingDefinitionDto[]))),
      effective: this.api
        .effective({
          levels: true,
          companyOnly: this.level() === 'COMPANY',
          branchUuid,
        })
        .pipe(catchError(() => of([] as EffectiveSettingDto[]))),
    }).subscribe(({ definitions, effective }) => {
      this.definitions.set(definitions);
      this.effective.set(effective);

      const state = buildFormState(definitions, effective, (definition) =>
        this.levelOf(definition),
      );
      this.initial.set(state);
      this.model.set({ ...state.model });
      this.overridden.set(new Set(state.overridden));

      this.settingsForm.set(this.buildForm(definitions));
      this.changes.capture();
      this.loading.set(false);
    });
  }

  /** El esquema sale del catálogo: un validador por definición, sin nombrar ninguna clave. */
  private buildForm(definitions: readonly SettingDefinitionDto[]): FieldTree<SettingsFormModel> {
    return form(this.model, settingsSchema(definitions), { injector: this.injector });
  }
}

function emptyState(): SettingsFormState {
  return { model: {}, overridden: new Set(), inherited: {} };
}
