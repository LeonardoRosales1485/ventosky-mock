import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, debounceTime, distinctUntilChanged, filter, map, skip, switchMap } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permission, Permissions } from '../../../../core/auth/permissions';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { resolveApiErrorMessage } from '../../../../core/http/api-error.model';
import { LanguageService } from '../../../../core/i18n/language.service';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { FilterMatchMode, MatTablePaginator } from '../../../../core/paginate';
import {
  DirectoryLink,
  isEmployeeSpecialty,
  partyRoleOfLink,
} from '../../../../core/parties/directory-links';
import { PartyDto, PartyRole, formatDocument } from '../../../../core/parties/party.model';
import { CurrencyDisplayComponent } from '../../../../shared/components/currency-display/currency-display.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  RowAction,
  RowActionsComponent,
} from '../../../../shared/components/row-actions/row-actions.component';
import { TableToolbarComponent } from '../../../../shared/components/table-toolbar/table-toolbar.component';
import { TableWrapperComponent } from '../../../../shared/components/table-wrapper/table-wrapper.component';
import { LocalizedDatePipe } from '../../../../shared/pipes/localized-date.pipe';
import {
  DirectoryFormDialogComponent,
  DirectoryFormDialogData,
  DirectoryFormDialogResult,
  DirectoryRecordRef,
} from '../../components/directory-form-dialog/directory-form-dialog.component';
import { DirectoryTreeComponent } from '../../components/directory-tree/directory-tree.component';
import {
  EmployeeFormDialogComponent,
  EmployeeFormDialogData,
  EmployeeFormDialogResult,
} from '../../components/employee-form-dialog/employee-form-dialog.component';
import {
  GrantAccessDialogComponent,
  GrantAccessDialogData,
  GrantAccessDialogResult,
} from '../../components/grant-access-dialog/grant-access-dialog.component';
import { DirectoryApiService } from '../../data-access/directory-api.service';
import {
  DirectoryFolderId,
  INCLUDE_TERMINATED_FILTER,
  directoryFolder,
  directoryTableConfig,
  isDirectoryFolderId,
  visibleDirectoryFolders,
} from '../../data-access/directory-folders';
import {
  DirectoryProfileDto,
  DirectoryRow,
  DirectoryUserDto,
  EmployeeProfileDto,
} from '../../data-access/directory.model';
import { rolesInCompany } from '../../data-access/directory-users';
import { DIRECTORY_PATHS } from '../../directory.paths';

/** Los listados del directorio abren de a 25: el árbol ocupa el costado y la página tiene lugar. */
const PAGE_SIZE = 25;

/** Los permisos de alta de cada vínculo, además del de acceso que un empleado no puede saltear. */
const CREATE_PERMISSION: Readonly<Record<PartyRole, Permission>> = {
  CUSTOMER: Permissions.customerCreate,
  SUPPLIER: Permissions.supplierCreate,
  EMPLOYEE: Permissions.employeeCreate,
};

/**
 * El Directorio: un árbol de carpetas a la izquierda y, a la derecha, el listado de la carpeta donde se está
 * parado. **Tocar una carpeta cambia las columnas, el título, la bajada, el botón de alta y el formulario
 * entero**: cada carpeta es un ABM, y el tipo de lo que se carga es la carpeta, no una tarjeta que se elige.
 *
 * Las carpetas que listan varios ABM —«Todos» y «Empleados»— no tienen formulario propio: su botón pide elegir
 * el tipo, porque una pantalla que cruza tres ABM no puede pedir los campos de ninguno. «Con acceso al sistema»
 * lista quién entra, tenga o no ficha, y su botón no es un alta: le suma credencial a alguien que ya está.
 */
@Component({
  selector: 'app-directory-page',
  imports: [
    CurrencyDisplayComponent,
    LocalizedDatePipe,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatPaginatorModule,
    MatSlideToggleModule,
    MatSortModule,
    MatTableModule,
    TranslatePipe,
    PageHeaderComponent,
    RowActionsComponent,
    TableToolbarComponent,
    TableWrapperComponent,
    DirectoryTreeComponent,
  ],
  providers: [DirectoryApiService],
  templateUrl: './directory.page.html',
  styleUrl: './directory.page.css',
})
export class DirectoryPage {
  private readonly api = inject(DirectoryApiService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly folders = visibleDirectoryFolders((permission) =>
    this.auth.hasPermission(permission),
  );

  protected readonly folderId = signal<DirectoryFolderId>(this.initialFolder());
  protected readonly folder = computed(() => directoryFolder(this.folderId()));
  protected readonly paginator = signal(this.createPaginator(this.folderId()));
  protected readonly counts = signal<Partial<Record<DirectoryFolderId, number>>>({});

  protected readonly displayedColumns = computed(() => [...this.folder().columns, 'actions']);
  protected readonly pageSizeOptions = [10, PAGE_SIZE, 50, 100];
  protected readonly searchQuery = signal('');
  protected readonly activeFilters = computed(() => Object.keys(this.paginator().filters()).length);
  protected readonly includeTerminated = computed(
    () => INCLUDE_TERMINATED_FILTER in this.paginator().filters(),
  );

  protected readonly formatDocument = formatDocument;

  /** Los vínculos que el usuario puede dar de alta desde la carpeta. En «Todos» y «Empleados», el menú. */
  protected readonly creatableLinks = computed<readonly DirectoryLink[]>(() => {
    const create = this.folder().create;
    if (create.kind === 'form') {
      return this.canCreate(create.link) ? [create.link] : [];
    }
    return create.kind === 'menu' ? create.links.filter((link) => this.canCreate(link)) : [];
  });

  protected readonly canGrantAccess =
    this.auth.hasPermission(Permissions.partyUserLink) &&
    (this.auth.hasPermission(Permissions.userCreate) ||
      this.auth.hasPermission(Permissions.userEdit));

  /** Las acciones de cada fila, armadas una vez por página: dependen de la carpeta y de lo que es cada fila. */
  protected readonly rowActions = computed(() => {
    this.language.currentLang();
    const folder = this.folderId();
    return new Map(
      this.paginator()
        .items()
        .map((row) => [row.uuid, this.actionsFor(folder, row)] as const),
    );
  });

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('folder')),
        filter(isDirectoryFolderId),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((folder) => this.enterFolder(folder));

    toObservable(this.searchQuery)
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => {
        if (value.trim() === this.paginator().globalFilter()) {
          return;
        }
        this.paginator().setGlobalFilter(value);
        void this.syncQueryParams();
      });

    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.directory', link: DIRECTORY_PATHS },
      { labelKey: `directory.folders.${this.folderId()}.label` },
    ]);

    this.loadCounts();
  }

  protected onPage(event: PageEvent): void {
    this.paginator().handlePageEvent(event);
    void this.syncQueryParams();
  }

  protected onSort(sort: Sort): void {
    this.paginator().handleSortChange(sort);
    void this.syncQueryParams();
  }

  protected onRefresh(): void {
    this.paginator().refresh();
    this.loadCounts();
  }

  protected onClearFilters(): void {
    this.paginator().clearFilters();
    void this.syncQueryParams();
  }

  protected onIncludeTerminatedChange(include: boolean): void {
    const filters = { ...this.paginator().filters() };
    if (include) {
      filters[INCLUDE_TERMINATED_FILTER] = { value: 'true', matchMode: FilterMatchMode.Equals };
    } else {
      delete filters[INCLUDE_TERMINATED_FILTER];
    }
    this.paginator().setFilters(filters);
    void this.syncQueryParams();
  }

  protected isSortable(column: string): boolean {
    return column in directoryTableConfig(this.folderId()).sort;
  }

  protected onCreate(link: DirectoryLink): void {
    this.openProfileDialog(link, null);
  }

  protected onGrantAccess(): void {
    this.openAccessDialog({});
  }

  protected onRowAction(actionId: string, row: DirectoryRow): void {
    const [action, target] = actionId.split(':');
    switch (action) {
      case 'edit':
        this.openRecord(this.recordOfRow(row));
        return;
      case 'open':
        this.openRecord(this.recordOfPartyRole(row as PartyDto, target as PartyRole));
        return;
      case 'access':
        this.openAccessDialog(this.accessDataOf(row));
        return;
      case 'delete':
        this.deleteRow(row);
        return;
    }
  }

  protected rolesOf(row: DirectoryRow): string {
    return ((row as PartyDto).roles ?? [])
      .map((role) => this.translate.instant(`directory.roleNames.${role.role}`))
      .join(' · ');
  }

  protected specialtiesOf(row: DirectoryRow): string {
    return ((row as EmployeeProfileDto).specialties ?? [])
      .filter(isEmployeeSpecialty)
      .map((specialty) => this.translate.instant(`directoryLinks.${specialty}`))
      .join(' · ');
  }

  protected grantedRolesOf(row: DirectoryRow): string {
    return rolesInCompany(row as DirectoryUserDto, this.auth.selectedCompanyUuid())
      .map((role) => role.name)
      .join(' · ');
  }

  protected directoryRolesOf(row: DirectoryRow): string {
    return ((row as DirectoryUserDto).party?.roles ?? [])
      .map((role) => this.translate.instant(`directory.roleNames.${role}`))
      .join(' · ');
  }

  private initialFolder(): DirectoryFolderId {
    const requested = this.route.snapshot.paramMap.get('folder');
    return isDirectoryFolderId(requested) ? requested : (this.folders[0]?.id ?? 'customers');
  }

  private enterFolder(folder: DirectoryFolderId): void {
    if (folder !== this.folderId()) {
      this.folderId.set(folder);
      this.paginator.set(this.createPaginator(folder));
    }
    const params = this.route.snapshot.queryParams;
    this.searchQuery.set(typeof params['q'] === 'string' ? params['q'] : '');
    if (Object.keys(params).length > 0) {
      this.paginator().applyQueryParams(params);
    } else {
      this.paginator().load();
    }
  }

  private createPaginator(folder: DirectoryFolderId): MatTablePaginator<DirectoryRow> {
    const config = directoryTableConfig(folder);
    return new MatTablePaginator<DirectoryRow>({
      fetchData: (query) => this.api.paginate(folder, query),
      sqlDialect: environment.paginateSqlDialect,
      defaultPageSize: PAGE_SIZE,
      globalSearchConfig: config.search,
      sortConfig: config.sort,
      defaultSort: config.defaultSort,
      filterConfig: directoryFolder(folder).hidesTerminated
        ? { [INCLUDE_TERMINATED_FILTER]: { tabla: 't', columna: INCLUDE_TERMINATED_FILTER } }
        : undefined,
    });
  }

  /** Cuántas filas tiene cada carpeta. Cada una llega por su lado: una lenta no demora a las demás. */
  private loadCounts(): void {
    for (const folder of this.folders) {
      this.api
        .count(folder.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (count) => this.counts.update((counts) => ({ ...counts, [folder.id]: count })),
          error: () => undefined,
        });
    }
  }

  private canCreate(link: DirectoryLink): boolean {
    if (!this.auth.hasPermission(CREATE_PERMISSION[partyRoleOfLink(link)])) {
      return false;
    }
    // El alta de un empleado exige su usuario: sin poder darle acceso, no hay alta posible.
    return !isEmployeeSpecialty(link) || this.canGrantAccess;
  }

  private actionsFor(folder: DirectoryFolderId, row: DirectoryRow): RowAction[] {
    const actions: RowAction[] = [];
    const t = (key: string): string => this.translate.instant(key);

    if (folder === 'access') {
      const user = row as DirectoryUserDto;
      if (this.canGrantAccess) {
        actions.push({
          id: 'access',
          icon: user.party ? 'manage_accounts' : 'link',
          label: t(
            user.party ? 'directory.actions.manageAccess' : 'directory.actions.linkToPerson',
          ),
        });
      }
      return actions;
    }

    if (folder === 'all') {
      for (const role of (row as PartyDto).roles ?? []) {
        if (this.auth.hasPermission(this.editPermissionOf(role.role))) {
          actions.push({
            id: `open:${role.role}`,
            icon:
              role.role === 'CUSTOMER'
                ? 'handshake'
                : role.role === 'SUPPLIER'
                  ? 'local_shipping'
                  : 'badge',
            label: t(`directory.actions.openAs.${role.role}`),
          });
        }
      }
    } else if (this.auth.hasPermission(this.editPermissionOf(this.roleOfFolder(folder)))) {
      actions.push({ id: 'edit', icon: 'edit', label: t('directory.actions.edit') });
    }

    if (this.canGrantAccess) {
      const hasUser = !!(row as PartyDto).userUuid;
      actions.push({
        id: 'access',
        icon: hasUser ? 'manage_accounts' : 'key',
        label: t(hasUser ? 'directory.actions.manageAccess' : 'directory.actions.grantAccess'),
      });
    }

    const remove = this.deleteActionOf(folder);
    if (remove) {
      actions.push({ ...remove, color: 'warn' });
    }
    return actions;
  }

  private deleteActionOf(folder: DirectoryFolderId): RowAction | null {
    const create = directoryFolder(folder).create;
    if (folder === 'employees') {
      return this.auth.hasPermission(Permissions.employeeDelete)
        ? {
            id: 'delete',
            icon: 'person_remove',
            label: this.translate.instant('directory.actions.deleteEmployee'),
          }
        : null;
    }
    if (create.kind !== 'form') {
      return null;
    }
    if (isEmployeeSpecialty(create.link)) {
      return this.auth.hasPermission(Permissions.employeeSpecialtyAssign)
        ? {
            id: 'delete',
            icon: 'remove_circle_outline',
            label: this.translate.instant('directory.actions.revokeSpecialty'),
          }
        : null;
    }
    const permission =
      create.link === 'CUSTOMER' ? Permissions.customerDelete : Permissions.supplierDelete;
    return this.auth.hasPermission(permission)
      ? {
          id: 'delete',
          icon: 'delete_outline',
          label: this.translate.instant(`directory.actions.deleteLink.${create.link}`),
        }
      : null;
  }

  private editPermissionOf(role: PartyRole): Permission {
    return role === 'CUSTOMER'
      ? Permissions.customerEdit
      : role === 'SUPPLIER'
        ? Permissions.supplierEdit
        : Permissions.employeeEdit;
  }

  private roleOfFolder(folder: DirectoryFolderId): PartyRole {
    const create = directoryFolder(folder).create;
    return create.kind === 'form' ? partyRoleOfLink(create.link) : 'EMPLOYEE';
  }

  /** La ficha de la fila en su propia carpeta. */
  private recordOfRow(row: DirectoryRow): DirectoryRecordRef {
    return { folder: this.folderId(), uuid: row.uuid };
  }

  /** En «Todos», la ficha de uno de los roles de la persona. */
  private recordOfPartyRole(party: PartyDto, role: PartyRole): DirectoryRecordRef | null {
    const roleRow = (party.roles ?? []).find((candidate) => candidate.role === role);
    if (!roleRow) {
      return null;
    }
    const folders = {
      CUSTOMER: 'customers',
      SUPPLIER: 'suppliers',
      EMPLOYEE: 'employees',
    } as const;
    return { folder: folders[role], uuid: roleRow.uuid };
  }

  /** Abre la ficha: la del vínculo de su carpeta, o la general si es la de «Empleados». */
  private openRecord(record: DirectoryRecordRef | null): void {
    if (!record) {
      return;
    }
    if (record.folder === 'employees') {
      this.api
        .getEmployee(record.uuid)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (employee) => this.openEmployeeDialog(employee),
          error: (error: unknown) => this.toastError(error, 'directory.toasts.loadError'),
        });
      return;
    }
    const create = directoryFolder(record.folder).create;
    if (create.kind !== 'form') {
      return;
    }
    this.api
      .getProfile(create.link, record.uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (profile) => this.openProfileDialog(create.link, profile),
        error: (error: unknown) => this.toastError(error, 'directory.toasts.loadError'),
      });
  }

  private openProfileDialog(link: DirectoryLink, profile: DirectoryProfileDto | null): void {
    this.dialog
      .open<DirectoryFormDialogComponent, DirectoryFormDialogData, DirectoryFormDialogResult>(
        DirectoryFormDialogComponent,
        {
          width: '64rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data: { link, profile },
        },
      )
      .afterClosed()
      .pipe(
        filter((result): result is DirectoryFormDialogResult => !!result),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.kind === 'open') {
          this.openRecord(result.record);
          return;
        }
        const key = !result.created
          ? 'directory.toasts.updated'
          : result.linkAdded
            ? 'directory.toasts.linkAdded'
            : 'directory.toasts.created';
        // Un aviso tapa al otro: si algo quedó a medias, eso es lo que hay que leer.
        if (result.warning) {
          this.toast.warning(result.warning);
        } else {
          this.toast.success(this.translate.instant(key, { name: result.name }));
        }
        this.afterChange();
      });
  }

  private openEmployeeDialog(employee: EmployeeProfileDto): void {
    this.dialog
      .open<EmployeeFormDialogComponent, EmployeeFormDialogData, EmployeeFormDialogResult>(
        EmployeeFormDialogComponent,
        {
          width: '60rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data: { employee },
        },
      )
      .afterClosed()
      .pipe(
        filter((result): result is EmployeeFormDialogResult => !!result),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.warning) {
          this.toast.warning(result.warning);
        } else {
          this.toast.success(
            this.translate.instant('directory.toasts.updated', { name: result.name }),
          );
        }
        this.afterChange();
      });
  }

  private openAccessDialog(data: GrantAccessDialogData): void {
    this.dialog
      .open<GrantAccessDialogComponent, GrantAccessDialogData, GrantAccessDialogResult>(
        GrantAccessDialogComponent,
        {
          width: '40rem',
          maxWidth: '95vw',
          autoFocus: 'first-heading',
          data,
        },
      )
      .afterClosed()
      .pipe(
        filter((result): result is GrantAccessDialogResult => !!result),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if (result.kind === 'granted') {
          this.toast.success(
            this.translate.instant('directory.toasts.accessGranted', { name: result.name }),
          );
        } else if (result.kind === 'rolesAdded') {
          this.toast.success(
            this.translate.instant('directory.toasts.rolesAdded', { username: result.username }),
          );
        } else {
          this.toast.success(
            this.translate.instant('directory.toasts.unlinked', { name: result.name }),
          );
        }
        this.afterChange();
      });
  }

  /**
   * Lo que el diálogo de acceso necesita de la fila. La ficha va armada con lo que la fila ya trae: quien sólo
   * administra empleados no siempre puede releerla del maestro, y el diálogo lo intenta igual.
   */
  private accessDataOf(row: DirectoryRow): GrantAccessDialogData {
    if (this.folderId() === 'access') {
      const user = row as DirectoryUserDto;
      return user.party
        ? {
            party: {
              uuid: user.party.uuid,
              name: user.party.name,
              userUuid: user.uuid,
              username: user.username,
              roles: [],
            },
          }
        : { user };
    }
    if (this.folderId() === 'all') {
      return { party: row as PartyDto };
    }
    const profile = row as DirectoryProfileDto;
    return {
      party: {
        uuid: profile.partyUuid ?? '',
        name: profile.name,
        docType: profile.docType,
        docNumber: profile.docNumber,
        userUuid: profile.userUuid,
        username: profile.username,
        roles: [],
      },
    };
  }

  private deleteRow(row: DirectoryRow): void {
    const folder = this.folderId();
    const create = directoryFolder(folder).create;
    const name = (row as PartyDto).name;
    let message: string;
    let request: Observable<unknown>;

    if (folder === 'employees') {
      message = this.translate.instant('directory.confirm.deleteEmployee', { name });
      request = this.api.deleteEmployee(row.uuid);
    } else if (create.kind === 'form') {
      const link = this.translate.instant(`directory.linkNouns.${create.link}`);
      message = this.translate.instant(
        isEmployeeSpecialty(create.link)
          ? 'directory.confirm.revokeSpecialty'
          : 'directory.confirm.deleteLink',
        { name, link },
      );
      request = this.api.deleteProfile(create.link, row.uuid);
    } else {
      return;
    }

    this.confirmDialog
      .confirm({ message, confirmLabel: this.translate.instant('directory.confirm.accept') })
      .pipe(
        filter(Boolean),
        switchMap(() => request),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('directory.toasts.deleted', { name }));
          this.afterChange();
        },
        error: (error: unknown) => this.toastError(error, 'directory.toasts.deleteError'),
      });
  }

  private afterChange(): void {
    this.paginator().refresh();
    this.loadCounts();
  }

  private toastError(error: unknown, fallbackKey: string): void {
    this.toast.error(resolveApiErrorMessage(error, this.translate.instant(fallbackKey)));
  }

  private async syncQueryParams(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.paginator().toQueryParams(),
      replaceUrl: true,
    });
  }
}
