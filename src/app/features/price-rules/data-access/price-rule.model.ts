import { Permissions } from '../../../core/auth/permissions';
import { Versioned } from '../../../core/concurrency/version-conflict.model';

export {
  DEFAULT_PRICE_ROUNDING_DIRECTION,
  DEFAULT_PRICE_ROUNDING_MODE,
  PRICE_ROUNDING_DIRECTIONS,
  PRICE_ROUNDING_MODES,
  roundAmount,
  toPriceRounding,
} from '../../../core/pricing/price-rounding';

/** Referencia liviana `{ uuid, name }` con la que el backend expone lista, sucursal, producto y categoría. */
export interface UuidNameRef {
  uuid: string;
  name: string;
}

/**
 * Tipos de cálculo de una regla (`Code/Pricing/PriceRuleType`). Desde `v63` es un enum Java sin tabla
 * catálogo: viaja por API como string plano, así que no hay nada que traer del servidor.
 *
 * - `MARKUP_PERCENT`: `precio = costo × (1 + p/100)` — recargo sobre el costo.
 * - `MARGIN_PERCENT`: `precio = costo / (1 − p/100)` — margen sobre el precio final, con `p < 100`.
 */
export const PRICE_RULE_TYPES = ['MARKUP_PERCENT', 'MARGIN_PERCENT'] as const;

export type PriceRuleType = (typeof PRICE_RULE_TYPES)[number];

export const DEFAULT_PRICE_RULE_TYPE: PriceRuleType = 'MARKUP_PERCENT';

/** Cota superior del porcentaje de un margen: en 100 % el divisor `1 − p/100` se anula. */
export const MARGIN_PERCENT_MAX = 100;

/** Una lista que la regla recalcula en una sucursal, con su porcentaje (`PriceRulePriceListDTO`). */
export interface PriceRulePriceListDto {
  uuid?: string;
  priceList?: UuidNameRef | null;
  branch?: UuidNameRef | null;
  percent?: number | null;
}

export interface PriceRuleProductLinkDto {
  uuid?: string;
  product?: UuidNameRef | null;
}

export interface PriceRuleCategoryLinkDto {
  uuid?: string;
  category?: UuidNameRef | null;
}

/**
 * Regla de precio (`PriceRuleDTO`), tal como la devuelven el paginado y el detalle.
 *
 * El paginado sólo trae encabezado + `priceLists`; `products` y `categories` llegan únicamente en
 * `GET /price-rule/uuid/{uuid}`, y ahí vienen **repetidos una vez por sucursal** de la regla, porque
 * el vínculo se persiste por (item × sucursal). Usá {@link linkedProductRefs} /
 * {@link linkedCategoryRefs} para leerlos sin duplicados.
 */
export interface PriceRuleDto extends Versioned {
  uuid: string;
  name: string;
  ruleType?: string | null;
  /** `PriceRoundingMode` (`v74`): a qué se redondea. Ausente ⇒ `TWO_DECIMALS`. */
  roundingMode?: string | null;
  /** `PriceRoundingDirection` (`v75`): para qué lado. Ausente ⇒ `NEAREST`. */
  roundingDirection?: string | null;
  priceLists?: PriceRulePriceListDto[] | null;
  products?: PriceRuleProductLinkDto[] | null;
  categories?: PriceRuleCategoryLinkDto[] | null;
  status?: number;
  /** ISO 8601 con offset (`2026-09-02T15:34:35.123-03:00`). */
  dateCreated?: string;
}

/**
 * Body de `POST /price-rule/save`.
 *
 * Las tres colecciones se sincronizan con lo enviado: lo ausente se desvincula. Se mandan siempre —
 * incluso vacías— para que el formulario sea la única fuente de verdad del alcance de la regla.
 */
export interface PriceRuleSavePayload {
  uuid?: string;
  /** Versión leída al hidratar el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
  name: string;
  ruleType: string;
  /**
   * Las dos mitades del criterio de redondeo. Viajan siempre —aunque sean los defaults— para que el
   * formulario sea la única fuente de verdad: cambiarlas recalcula todos los productos de la regla.
   */
  roundingMode: string;
  roundingDirection: string;
  priceLists: { priceList: { uuid: string }; branch: { uuid: string }; percent: number }[];
  products: { product: { uuid: string } }[];
  categories: { category: { uuid: string } }[];
}

/** Lista de precios candidata a ser recalculada por una regla. */
export interface PriceListOption {
  uuid: string;
  name: string;
  isPrincipal?: boolean | null;
  isActive?: boolean | null;
  isCost?: boolean | null;
}

/** Producto devuelto por el buscador del alcance (`POST /product/paginate`). */
export interface ProductOption {
  uuid: string;
  name: string;
  sku?: string | null;
}

export const PRICE_RULE_VIEW_PERMISSION = Permissions.priceRuleView;
export const PRICE_RULE_CREATE_PERMISSION = Permissions.priceRuleCreate;
export const PRICE_RULE_EDIT_PERMISSION = Permissions.priceRuleEdit;
export const PRICE_RULE_DELETE_PERMISSION = Permissions.priceRuleDelete;

/** Productos vinculados, sin la repetición por sucursal con la que los persiste el backend. */
export function linkedProductRefs(rule: PriceRuleDto): UuidNameRef[] {
  return dedupeRefs((rule.products ?? []).map((link) => link.product));
}

/** Categorías vinculadas, sin la repetición por sucursal con la que las persiste el backend. */
export function linkedCategoryRefs(rule: PriceRuleDto): UuidNameRef[] {
  return dedupeRefs((rule.categories ?? []).map((link) => link.category));
}

/** Filas completas de la grilla: las que traen lista, sucursal y porcentaje. */
export function priceListRows(rule: PriceRuleDto): PriceRulePriceListDto[] {
  return (rule.priceLists ?? []).filter((row) => row.priceList != null && row.branch != null);
}

/**
 * Sucursales en las que la regla existe: las distintas que aparecen en la grilla. Es lo que define
 * el alcance —los vínculos a productos y categorías se crean una vez por cada una—, y por eso una
 * regla sin listas se resuelve pero no recalcula ningún precio.
 */
export function ruleBranchRefs(rule: PriceRuleDto): UuidNameRef[] {
  return dedupeRefs(priceListRows(rule).map((row) => row.branch));
}

function dedupeRefs(refs: readonly (UuidNameRef | null | undefined)[]): UuidNameRef[] {
  const byUuid = new Map<string, UuidNameRef>();

  for (const ref of refs) {
    if (ref?.uuid) {
      byUuid.set(ref.uuid, ref);
    }
  }

  return [...byUuid.values()];
}
