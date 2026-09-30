import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, switchMap } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { Permissions } from '../../../../core/auth/permissions';
import { ConfirmDialogService } from '../../../../core/confirm/confirm-dialog.service';
import { API_ERROR_CODES, hasApiErrorCode } from '../../../../core/http/api-error.model';
import { BREADCRUMB_HOME } from '../../../../core/layout/breadcrumb.model';
import { BreadcrumbService } from '../../../../core/layout/breadcrumb.service';
import { ToastService } from '../../../../core/notifications/toast.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { PRODUCT_OPTIONS_PATHS } from '../../product-options.paths';
import {
  ProductOptionDto,
  ProductOptionValueDto,
} from '../../data-access/product-option.model';
import { ProductOptionsApiService } from '../../data-access/product-options-api.service';

/**
 * Catálogo de ejes de variante y sus valores (§13.3, wireframe `1i`).
 *
 * **Dos paneles y no dos pantallas:** a la izquierda los ejes, a la derecha los valores del elegido.
 * Elegir el eje y editar sus valores es una sola tarea; partirla en dos pantallas obligaría a ir y
 * volver por cada talle.
 *
 * El listado de ejes **no se pagina**: son cinco o seis en la vida de una empresa —Talle, Color,
 * Capacidad, Voltaje, Medida— y un paginador sobre esa lista es andamiaje sin carga.
 */
@Component({
  selector: 'app-product-options-page',
  imports: [
    DragDropModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
    PageHeaderComponent,
  ],
  providers: [ProductOptionsApiService],
  templateUrl: './product-options.page.html',
  styleUrl: './product-options.page.css',
})
export class ProductOptionsPage implements OnInit {
  private readonly api = inject(ProductOptionsApiService);
  private readonly auth = inject(AuthService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly options = signal<readonly ProductOptionDto[]>([]);
  protected readonly selectedUuid = signal<string | null>(null);
  protected readonly loadingOptions = signal(false);
  protected readonly loadingValues = signal(false);
  protected readonly saving = signal(false);

  /** El eje abierto, con sus valores editables. Es el borrador: no se guarda hasta confirmarlo. */
  protected readonly draftName = signal('');
  protected readonly draftValues = signal<ProductOptionValueDto[]>([]);
  private editedVersion: number | undefined;

  protected readonly selected = computed(() =>
    this.options().find((option) => option.uuid === this.selectedUuid()) ?? null,
  );

  protected readonly canCreate = computed(() => this.auth.hasPermission(Permissions.productOptionCreate));
  protected readonly canEdit = computed(() => this.auth.hasPermission(Permissions.productOptionEdit));
  protected readonly canDelete = computed(() => this.auth.hasPermission(Permissions.productOptionDelete));

  constructor() {
    this.breadcrumb.publish(() => [
      BREADCRUMB_HOME,
      { labelKey: 'nav.items.productOptions', link: PRODUCT_OPTIONS_PATHS },
    ]);
  }

  ngOnInit(): void {
    this.loadOptions();
  }

  private loadOptions(selectUuid?: string): void {
    this.loadingOptions.set(true);
    this.api
      .paginate({ page: 1, size: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.options.set(data.content ?? []);
          this.loadingOptions.set(false);
          const next = selectUuid ?? this.selectedUuid() ?? this.options()[0]?.uuid ?? null;
          if (next) {
            this.selectOption(next);
          }
        },
        error: () => {
          this.loadingOptions.set(false);
          this.toast.error(this.translate.instant('productOptions.toasts.loadError'));
        },
      });
  }

  /**
   * Los valores se piden al elegir el eje y no vienen en el listado: el panel izquierdo sólo muestra
   * un número, y traer los valores de los seis ejes para dibujarlo serían seis consultas de más.
   */
  protected selectOption(uuid: string): void {
    this.selectedUuid.set(uuid);
    this.loadingValues.set(true);
    this.api
      .getByUuid(uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (option) => {
          this.editedVersion = option.version;
          this.draftName.set(option.name);
          this.draftValues.set((option.values ?? []).map((value) => ({ ...value })));
          this.loadingValues.set(false);
        },
        error: () => {
          this.loadingValues.set(false);
          this.toast.error(this.translate.instant('productOptions.toasts.loadError'));
        },
      });
  }

  protected onCreateOption(): void {
    this.selectedUuid.set(null);
    this.editedVersion = undefined;
    this.draftName.set('');
    this.draftValues.set([]);
  }

  protected onAddValue(): void {
    this.draftValues.update((values) => [...values, { value: '', code: null, variantsInUse: 0 }]);
  }

  protected onValueChange(index: number, value: string): void {
    this.draftValues.update((values) =>
      values.map((row, i) => (i === index ? { ...row, value } : row)),
    );
  }

  protected onCodeChange(index: number, code: string): void {
    this.draftValues.update((values) =>
      values.map((row, i) => (i === index ? { ...row, code: code || null } : row)),
    );
  }

  /**
   * Quitar una fila del borrador es lo que el backend lee como borrarla. Si está en uso responde
   * `OPTION_VALUE_IN_USE` al guardar, pero la columna «Variantes en uso» ya lo venía diciendo: acá
   * se corta antes para no ofrecer una acción que va a fallar.
   */
  protected onRemoveValue(index: number): void {
    const row = this.draftValues()[index];
    if ((row.variantsInUse ?? 0) > 0) {
      this.toast.error(
        this.translate.instant('productOptions.toasts.valueInUse', {
          value: row.value,
          count: row.variantsInUse,
        }),
      );
      return;
    }
    this.draftValues.update((values) => values.filter((_, i) => i !== index));
  }

  /**
   * El orden es la posición en la lista: el backend reasigna `displayOrder` por posición, así que
   * arrastrar **es** editar el orden. Es lo que hace que `L` salga después de `M`.
   */
  protected onDropValue(event: CdkDragDrop<ProductOptionValueDto[]>): void {
    this.draftValues.update((values) => {
      const next = [...values];
      moveItemInArray(next, event.previousIndex, event.currentIndex);
      return next;
    });
  }

  protected onSave(): void {
    const name = this.draftName().trim();
    if (!name) {
      this.toast.error(this.translate.instant('productOptions.toasts.nameRequired'));
      return;
    }
    this.saving.set(true);
    this.api
      .save({
        uuid: this.selectedUuid() ?? undefined,
        name,
        version: this.editedVersion,
        values: this.draftValues().map((row) => ({
          uuid: row.uuid,
          value: row.value.trim(),
          code: row.code?.trim() || null,
        })),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.toast.success(this.translate.instant('productOptions.toasts.saved'));
          this.loadOptions(saved.uuid);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(this.saveErrorMessage(error));
        },
      });
  }

  /**
   * Los dos errores que el usuario puede resolver solo —el nombre repetido y el valor en uso— se
   * traducen; el resto cae en el mensaje genérico.
   */
  private saveErrorMessage(error: unknown): string {
    if (hasApiErrorCode(error, API_ERROR_CODES.OPTION_NAME_DUPLICATED)) {
      return this.translate.instant('productOptions.toasts.nameDuplicated');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.OPTION_VALUE_IN_USE)) {
      return this.translate.instant('productOptions.toasts.saveValueInUse');
    }
    if (hasApiErrorCode(error, API_ERROR_CODES.OPTION_VALUE_DUPLICATED)) {
      return this.translate.instant('productOptions.toasts.valueDuplicated');
    }
    return this.translate.instant('productOptions.toasts.saveError');
  }

  protected onDeleteOption(option: ProductOptionDto): void {
    this.confirmDialog
      .confirm({
        message: this.translate.instant('productOptions.confirmDelete', { name: option.name }),
        confirmLabel: this.translate.instant('productOptions.actions.delete'),
      })
      .pipe(
        filter(Boolean),
        switchMap(() => this.api.delete(option.uuid)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('productOptions.toasts.deleted'));
          this.selectedUuid.set(null);
          this.loadOptions();
        },
        error: (error: unknown) => {
          this.toast.error(
            this.translate.instant(
              hasApiErrorCode(error, API_ERROR_CODES.OPTION_VALUE_IN_USE)
                ? 'productOptions.toasts.optionInUse'
                : 'productOptions.toasts.deleteError',
            ),
          );
        },
      });
  }
}
