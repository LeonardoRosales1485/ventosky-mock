import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  form,
  FormField,
  maxLength,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, catchError, debounceTime, map, of, skip, switchMap } from 'rxjs';
import { LanguageService } from '../../../../core/i18n/language.service';
import { DIRECTORY_LINKS, DirectoryLink } from '../../../../core/parties/directory-links';
import { DirectoryLinksApiService } from '../../../../core/parties/directory-links-api.service';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { PermissionsApiService } from '../../data-access/permissions-api.service';
import { PermissionDto, RoleDto } from '../../data-access/role.model';

export interface RoleFormDialogData {
  role: RoleDto | null;
}

export interface RoleFormDialogResult {
  uuid?: string;
  name: string;
  isDefault: number;
  permissions: Pick<PermissionDto, 'uuid'>[];
  /**
   * Versión que traía el rol al abrir el diálogo —la del DTO completo que relee la página, no la de
   * la fila—, para que el guardado la reenvíe y el backend pueda detectar si alguien más lo editó
   * mientras tanto. Ausente en un alta.
   */
  version?: number;
}

interface RoleFormModel {
  name: string;
  isDefault: boolean;
  permissionUuids: string[];
}

/**
 * Alta y edición de un rol con sus permisos.
 *
 * Mientras se eligen los permisos, el diálogo le pregunta al backend qué vínculos del directorio **es** quien tenga
 * el rol —los que tienen la firma de permisos entera— y lo avisa: *«Quien tenga este rol es transportista y
 * vendedor por sus permisos»*. No se confirma nada: los permisos son la única verdad, y al darle el rol a alguien,
 * el directorio le pide los datos de esos vínculos. El aviso es para que quien arma el rol sepa en qué se mete.
 */
@Component({
  selector: 'app-role-form-dialog',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  providers: [PermissionsApiService],
  templateUrl: './role-form-dialog.component.html',
  styleUrl: './role-form-dialog.component.css',
})
export class RoleFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<RoleFormDialogComponent, RoleFormDialogResult>,
  );
  private readonly data = inject<RoleFormDialogData>(MAT_DIALOG_DATA);
  private readonly permissionsApi = inject(PermissionsApiService);
  private readonly linksApi = inject(DirectoryLinksApiService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isEdit = this.data.role !== null;
  protected readonly permissionsLoading = signal(true);
  protected readonly permissions = signal<PermissionDto[]>([]);

  /** Los vínculos que son los permisos elegidos ahora. */
  protected readonly detectedLinks = signal<DirectoryLink[]>([]);

  private readonly model = signal<RoleFormModel>({
    name: this.data.role?.name ?? '',
    isDefault: (this.data.role?.isDefault ?? 0) === 1,
    permissionUuids: (this.data.role?.permissions ?? []).map((p) => p.uuid),
  });

  protected readonly roleForm = form(this.model, (path) => {
    required(path.name);
    minLength(path.name, 2);
    maxLength(path.name, 100);
  });

  protected readonly detectedLabel = computed(() => this.labelOf(this.detectedLinks()));

  constructor() {
    // En un alta no hay permisos que medir hasta que se elige el primero; en una edición, los del rol ya cuentan.
    toObservable(computed(() => this.model().permissionUuids))
      .pipe(
        skip(this.isEdit ? 0 : 1),
        debounceTime(300),
        switchMap((uuids) => this.detect(uuids)),
        takeUntilDestroyed(),
      )
      .subscribe((links) => this.detectedLinks.set(links));
  }

  ngOnInit(): void {
    this.permissionsApi
      .paginate({ page: 1, size: 200, filtros: [], ordenes: [], relaciones: [] })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.permissions.set(page.content ?? []);
          this.permissionsLoading.set(false);
        },
        error: () => {
          this.permissions.set([]);
          this.permissionsLoading.set(false);
        },
      });
  }

  protected onIsDefaultChange(checked: boolean): void {
    this.roleForm.isDefault().value.set(checked);
  }

  protected onPermissionsChange(uuids: string[]): void {
    this.roleForm.permissionUuids().value.set(uuids);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.roleForm().invalid()) {
      this.roleForm().markAsTouched();
      return;
    }

    void submit(this.roleForm, async () => {
      const value = this.model();
      const name = value.name.trim();
      if (!name) {
        return;
      }
      this.dialogRef.close({
        uuid: this.data.role?.uuid,
        name,
        isDefault: value.isDefault ? 1 : 0,
        permissions: value.permissionUuids.map((uuid) => ({ uuid })),
        version: this.data.role?.version,
      });
    });
  }

  /** Qué vínculos son esos permisos, en el orden del directorio. Si el cálculo falla, el aviso no se muestra. */
  private detect(permissionUuids: readonly string[]): Observable<DirectoryLink[]> {
    if (permissionUuids.length === 0) {
      return of([]);
    }
    return this.linksApi.detect({ permissionUuids: [...permissionUuids] }).pipe(
      map((detected) => {
        const codes = new Set(detected.map((candidate) => candidate.link));
        return DIRECTORY_LINKS.filter((link) => codes.has(link));
      }),
      catchError(() => of<DirectoryLink[]>([])),
    );
  }

  private labelOf(links: readonly DirectoryLink[]): string {
    this.language.currentLang();
    const labels = links.map((link) => this.translate.instant(`directoryLinks.${link}`));
    if (labels.length <= 1) {
      return labels.join('');
    }
    return this.translate.instant('roles.directoryLinks.join', {
      first: labels.slice(0, -1).join(', '),
      last: labels[labels.length - 1],
    });
  }
}
