import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  applyEach,
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';
import {
  ATTRIBUTE_VALUE_TYPES,
  AttributeValueType,
  DEFAULT_ATTRIBUTE_VALUE_TYPE,
  isAttributeValueType,
} from '../../../../core/attributes/attribute-value-type';
import { FieldErrorPipe } from '../../../../shared/pipes/field-error.pipe';
import { CategoriesApiService } from '../../data-access/categories-api.service';
import { CategoryAttributeDto, CategoryTreeNode } from '../../data-access/category.model';

export interface CategoryFormDialogData {
  category: CategoryTreeNode | null;
  /** When creating a subcategory, the parent node. */
  parent: CategoryTreeNode | null;
}

export interface CategoryFormDialogResult {
  uuid?: string;
  name: string;
  parentUuid: string | null;
  /**
   * Versión que traía la categoría cuando el diálogo la leyó, para que el guardado la reenvíe.
   *
   * Ausente en un alta, y también cuando `GET /category/uuid` falló: ahí no hay versión que
   * informar y el backend contesta 409, que es exactamente lo que corresponde.
   */
  version?: number;
  /**
   * Atributos propios de la categoría, tal como quedan tras editarlos.
   *
   * `null` significa «no tocar»: el backend da de baja los atributos que no vengan en el payload,
   * así que si no se pudieron cargar los actuales la propiedad se omite en vez de mandarse vacía.
   */
  attributes: CategoryAttributeDto[] | null;
}

/** Una fila de la grilla de atributos. `uuid` nulo = atributo nuevo, todavía sin persistir. */
interface CategoryAttributeFormEntry {
  uuid: string | null;
  name: string;
  type: AttributeValueType;
}

interface CategoryFormModel {
  name: string;
  attributes: CategoryAttributeFormEntry[];
}

const NAME_MAX_LENGTH = 255;
const ATTRIBUTE_NAME_MAX_LENGTH = 255;

/**
 * Alta y edición de categoría. Los atributos son opcionales: la sección arranca vacía y se van
 * agregando filas `{ nombre, tipo }`, que el `POST /category/save` persiste junto con la categoría.
 *
 * Al editar hay que traer los atributos actuales con `GET /category/uuid/{uuid}` —el árbol no los
 * incluye— porque el backend interpreta la lista enviada como el estado final: lo que no viaja se
 * da de baja.
 */
@Component({
  selector: 'app-category-form-dialog',
  imports: [
    MatButtonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    FormField,
    TranslatePipe,
    FieldErrorPipe,
  ],
  providers: [CategoriesApiService],
  templateUrl: './category-form-dialog.component.html',
  styleUrl: './category-form-dialog.component.css',
})
export class CategoryFormDialogComponent implements OnInit {
  private readonly dialogRef = inject(
    MatDialogRef<CategoryFormDialogComponent, CategoryFormDialogResult>,
  );
  private readonly data = inject<CategoryFormDialogData>(MAT_DIALOG_DATA);
  private readonly categoriesApi = inject(CategoriesApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly attributeNameInputs =
    viewChildren<ElementRef<HTMLInputElement>>('attributeName');

  protected readonly isEdit = this.data.category !== null;
  protected readonly parentName = this.data.parent?.name ?? null;
  protected readonly attributeTypes = ATTRIBUTE_VALUE_TYPES;

  protected readonly attributesLoading = signal(this.data.category !== null);
  /** `true` cuando no se pudieron leer los atributos actuales: se editan sólo nombre y ubicación. */
  protected readonly attributesUnavailable = signal(false);
  /** Versión del registro leído; viaja de vuelta en el resultado para el bloqueo optimista. */
  private version: number | undefined;

  private readonly model = signal<CategoryFormModel>({
    name: this.data.category?.name ?? '',
    attributes: [],
  });

  protected readonly categoryForm = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, NAME_MAX_LENGTH);

    applyEach(path.attributes, (attribute) => {
      required(attribute.name);
      maxLength(attribute.name, ATTRIBUTE_NAME_MAX_LENGTH);
      required(attribute.type);
      // Mismo rechazo que `CategoryService.mergeCategoryAttributes`, antes de gastar el request.
      validate(attribute.name, ({ value, valueOf }) => {
        const name = normalizeName(value());
        if (!name) {
          return null;
        }

        const repeated = valueOf(path.attributes).filter(
          (entry) => normalizeName(entry.name) === name,
        );
        return repeated.length > 1 ? { kind: 'duplicateAttribute' } : null;
      });
    });
  });

  ngOnInit(): void {
    const uuid = this.data.category?.uuid;
    if (!uuid) {
      return;
    }

    this.categoriesApi
      .getByUuid(uuid)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (category) => {
          this.version = category.version;
          this.model.update((current) => ({
            ...current,
            attributes: toAttributeEntries(category.categoryAttributes),
          }));
          this.attributesLoading.set(false);
        },
        error: () => {
          this.attributesUnavailable.set(true);
          this.attributesLoading.set(false);
        },
      });
  }

  protected onAddAttribute(): void {
    this.model.update((current) => ({
      ...current,
      attributes: [
        ...current.attributes,
        { uuid: null, name: '', type: DEFAULT_ATTRIBUTE_VALUE_TYPE },
      ],
    }));

    // La fila recién agregada no existe hasta el próximo render: recién ahí se le puede dar foco.
    afterNextRender(
      () => {
        const inputs = this.attributeNameInputs();
        inputs[inputs.length - 1]?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  protected onRemoveAttribute(index: number): void {
    this.model.update((current) => ({
      ...current,
      attributes: current.attributes.filter((_, position) => position !== index),
    }));
  }

  protected onAttributeTypeChange(index: number, type: AttributeValueType): void {
    this.categoryForm.attributes[index].type().value.set(type);
    this.categoryForm.attributes[index].type().markAsTouched();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();

    if (this.categoryForm().invalid()) {
      this.categoryForm().markAsTouched();
      return;
    }

    void submit(this.categoryForm, async () => {
      const value = this.model();
      const name = value.name.trim();
      if (!name) {
        return;
      }

      const parentUuid = this.isEdit
        ? (this.data.category?.parentUuid ?? null)
        : (this.data.parent?.uuid ?? null);

      this.dialogRef.close({
        uuid: this.data.category?.uuid,
        name,
        parentUuid,
        version: this.version,
        attributes: this.attributesUnavailable() ? null : toAttributeDtos(value.attributes),
      });
    });
  }
}

function toAttributeEntries(
  attributes: readonly CategoryAttributeDto[] | null | undefined,
): CategoryAttributeFormEntry[] {
  return (attributes ?? []).map((attribute) => ({
    uuid: attribute.uuid ?? null,
    name: attribute.name,
    // Un tipo desconocido (agregado por una versión más nueva del backend) se edita como texto.
    type: isAttributeValueType(attribute.type) ? attribute.type : DEFAULT_ATTRIBUTE_VALUE_TYPE,
  }));
}

function toAttributeDtos(
  attributes: readonly CategoryAttributeFormEntry[],
): CategoryAttributeDto[] {
  return attributes.map((attribute) => ({
    ...(attribute.uuid ? { uuid: attribute.uuid } : {}),
    name: attribute.name.trim(),
    type: attribute.type,
  }));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}
