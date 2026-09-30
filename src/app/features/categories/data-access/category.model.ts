import { Versioned } from '../../../core/concurrency/version-conflict.model';

/** Nested parent/child reference used on detail and save payloads. */
export interface CategoryRef {
  uuid: string;
  name?: string;
}

export interface CategoryAttributeDto {
  /** Ausente en un atributo nuevo; el backend lo asigna al crearlo. */
  uuid?: string;
  name: string;
  /** Uno de los `ATTRIBUTE_VALUE_TYPES` de `core/attributes`. */
  type: string;
}

/**
 * Recursive node from `GET /category/getAllTree`.
 * Leaf ⇒ `subCategories: null`. Roots omit `parentCategory`.
 */
export interface CategoryTreeNodeDto {
  uuid: string;
  name: string;
  parentCategory?: CategoryRef | null;
  subCategories: CategoryTreeNodeDto[] | null;
}

/** Detail / save response (`CategoryDTO`). Immediate children only when present. */
export interface CategoryDto extends Versioned {
  uuid: string;
  name: string;
  hasChildren?: boolean;
  parentCategory?: CategoryRef | null;
  subCategories?: CategoryNodeDto[] | null;
  categoryAttributes?: CategoryAttributeDto[] | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

/** Light node from `/parents` and `/children/{uuid}` (level-by-level navigation). */
export interface CategoryNodeDto {
  uuid: string;
  name: string;
  hasChildren: boolean;
}

export interface CategorySavePayload {
  uuid?: string;
  name: string;
  parentCategory?: CategoryRef | null;
  categoryAttributes?: CategoryAttributeDto[] | null;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}

/**
 * UI tree node. Children come preloaded from `getAllTree`.
 *
 * Sin `version` a propósito: `CategoryTreeNodeDTO` no lleva los campos del Core, así que guardar
 * desde el árbol —mover una categoría de padre— tiene que leer la versión con `GET /category/uuid`
 * justo antes.
 */
export interface CategoryTreeNode {
  uuid: string;
  name: string;
  parentUuid: string | null;
  children: CategoryTreeNode[];
  expanded: boolean;
}

/** Maps a recursive `getAllTree` DTO into the UI tree (children always present). */
export function fromAllTreeDto(
  dto: CategoryTreeNodeDto,
  parentUuid: string | null = null,
): CategoryTreeNode {
  const resolvedParent = parentUuid ?? dto.parentCategory?.uuid ?? null;
  const children = (dto.subCategories ?? []).map((child) =>
    fromAllTreeDto(child, dto.uuid),
  );

  return {
    uuid: dto.uuid,
    name: dto.name,
    parentUuid: resolvedParent,
    children,
    expanded: false,
  };
}

export function toTreeNode(
  dto: Pick<CategoryDto, 'uuid' | 'name' | 'parentCategory'> | CategoryTreeNodeDto,
  parentUuid: string | null = null,
): CategoryTreeNode {
  return {
    uuid: dto.uuid,
    name: dto.name,
    parentUuid: parentUuid ?? dto.parentCategory?.uuid ?? null,
    children: [],
    expanded: false,
  };
}
