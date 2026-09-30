import { Permissions } from '../../../core/auth/permissions';
import { Versioned } from '../../../core/concurrency/version-conflict.model';

/** Light `{ uuid, name }` reference used by the paginate DTO for brand/category/branch. */
export interface UuidNameRef {
  uuid: string;
  name: string;
}

/** One price of a product in a given price list (`ProductPriceListEntryDTO`). */
export interface ProductPriceListEntryDto {
  priceListUuid: string;
  price: number | null;
}

/**
 * Row of `POST /product/paginate-all` (`ProductPaginateDTO`).
 * `priceListEntries` only carries the lists that actually have a price for the product:
 * a missing entry means "no price in that list", not zero.
 */
export interface ProductPaginateDto {
  uuid: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  /** `UnitMeasure` enum name: UNIT, KILOGRAM, LITER, … */
  unitMeasure?: string | null;
  /**
   * Decimales que admite una cantidad de este producto, derivados de {@link unitMeasure}. `0` sólo
   * acepta enteros; `null` es el producto sin unidad declarada, sin restricción. Ver
   * `core/product/quantity-precision.ts`.
   */
  unitDecimalPlaces?: number | null;
  brand?: UuidNameRef | null;
  category?: UuidNameRef | null;
  isForPurchase?: boolean | null;
  isForSale?: boolean | null;
  taxRate?: number | null;
  lowStock?: number | null;
  optimalStock?: number | null;
  /** Los ejes del producto ({@link PRODUCT_TYPES}, {@link STOCK_TRACKING_MODES}, {@link EXPIRATION_CONTROLS}). */
  type?: string | null;
  stockTracking?: string | null;
  expirationControl?: string | null;
  standardCost?: number | null;
  /** `false` para los productos sin control de existencias: ahí `totalStock` viene en `null`. */
  tracksStock?: boolean | null;
  /** Stock of the active branch (header `X-Branch-Uuid`). `null` cuando el producto no lleva stock. */
  totalStock?: number | null;
  priceListEntries?: ProductPriceListEntryDto[] | null;
  branches?: UuidNameRef[] | null;
  /**
   * El modelo que agrupa a esta variante, o ausente en un producto suelto (RN-11).
   *
   * Es lo que le permite al listado agrupar las doce variantes de una remera bajo una fila en vez
   * de inundarlo. De sólo lectura: la pertenencia al modelo se define en la matriz.
   */
  model?: UuidNameRef | null;
  /** Qué valor fija la variante en cada eje: «Talle: M». Vacío en un producto sin modelo. */
  variantValues?: ProductVariantValueRef[] | null;
  /** El producto se pesa en balanza: se vende por peso y su saldo lleva decimales (RN-18). */
  isWeighable?: boolean | null;
  /**
   * Cuántos componentes activos tiene el kit, o ausente en un producto que no es kit. La composición
   * entera no viaja en el paginado —son varias filas por kit y ninguna se dibuja—, pero el tamaño
   * alcanza para decir «3 comp.» sin abrir la ficha.
   */
  kitItemsCount?: number | null;
  /**
   * Uno de {@link KIT_MODES}; ausente en un producto que no es kit, y un kit anterior a la Entrega G
   * se lee como `EXPLODE` ({@link toKitMode}).
   *
   * Viaja en el paginado desde el backend `6.4.0` porque es lo que decide **cómo se lee la fila
   * entera**: un virtual no tiene saldo y su disponible se deriva de los componentes (RN-07); un
   * armado tiene stock propio y se vende como cualquier mercadería (RN-22). Sin él, el listado y el
   * punto de venta sólo ven `type = KIT` y tratan a los dos igual.
   */
  kitMode?: string | null;
  /**
   * Si el producto ya apareció en una línea de orden o en un movimiento de stock, desde el backend
   * `6.10.0`. Ausente en un backend anterior, y ausente **no es `false`**.
   *
   * Está para el diálogo de archivado: archivar no se deshace y lo que cambia según la historia son
   * los tres códigos (ADR 0001) — el que nunca se movió los devuelve al pool y el que se movió se los
   * queda para siempre. No se deriva de {@link totalStock}: un producto comprado y vendido entero
   * tiene saldo cero y una historia completa.
   */
  hasMovements?: boolean | null;
  status?: number;
}

/** Un valor que una variante fija en un eje, tal como lo devuelve el paginado. */
export interface ProductVariantValueRef {
  optionValueUuid?: string;
  optionUuid?: string;
  optionName?: string;
  value?: string;
  code?: string | null;
}

/** Row of `POST /price-list/paginate` (`PriceListPaginateDTO`). */
export interface PriceListDto {
  uuid: string;
  name: string;
  isPrincipal?: boolean | null;
  isActive?: boolean | null;
  /** Reserved cost list; excluded from `priceListEntries` by the backend. */
  isCost?: boolean | null;
}

/** Una lista que la regla recalcula, con el porcentaje que le aplica (`PriceRulePriceListDTO`). */
export interface ProductPriceRuleListDto {
  priceList?: UuidNameRef | null;
  percent?: number | null;
}

/**
 * Regla de precio efectiva del producto en la sucursal activa (`GET /price-rule/product/{uuid}`),
 * resuelta por jerarquía: producto → categoría → categorías ancestro. Sin regla el backend responde
 * `204`, que el cliente ve como `null`.
 *
 * `priceLists` ya viene acotada a la sucursal del request: son las listas que la regla recalcula
 * *acá*, no en todas las sucursales donde existe.
 */
export interface ProductPriceRuleDto {
  uuid: string;
  name: string;
  /** `MARKUP_PERCENT` | `MARGIN_PERCENT`, el enum `PriceRuleType` del backend. */
  ruleType?: string | null;
  /** `PriceRoundingMode` (`v74`): a qué se redondea el precio que la regla calcula. */
  roundingMode?: string | null;
  /** `PriceRoundingDirection` (`v75`): para qué lado. */
  roundingDirection?: string | null;
  priceLists?: ProductPriceRuleListDto[] | null;
}

/** Recursive node of `GET /category/getAllTree`. Leaf ⇒ `subCategories: null`. */
export interface CategoryTreeNodeDto {
  uuid: string;
  name: string;
  subCategories: CategoryTreeNodeDto[] | null;
}

/** Category select option: the tree flattened with its depth and full path. */
export interface CategoryOption {
  uuid: string;
  name: string;
  depth: number;
  /** `Bebidas / Gaseosas`, shown as the option tooltip. */
  path: string;
  /** The category itself plus every descendant, for the `IN` filter. */
  subtreeUuids: string[];
}

/**
 * `UnitMeasure` enum names, in the order the backend declares them. Since `v63` the unit is a Java
 * enum (the `unit_measures` table is gone), so there is no catalogue to fetch: the product sends and
 * receives the plain name (`"KILOGRAM"`) and the label is a `products.unitMeasures.*` translation.
 */
export const UNIT_MEASURES = [
  'UNIT',
  'KILOGRAM',
  'GRAM',
  'LITER',
  'MILLILITER',
  'METER',
  'CENTIMETER',
  'BOX',
  'PACK',
  'DOZEN',
  'PAIR',
  'TON',
] as const;

export type UnitMeasure = (typeof UNIT_MEASURES)[number];

/** `UnitMeasure.defaultUnit()`. */
export const DEFAULT_UNIT_MEASURE: UnitMeasure = 'UNIT';

/** Default of `Product.taxRate` in the backend entity. */
export const DEFAULT_TAX_RATE = 21;

/**
 * Los tres ejes ortogonales del producto (`ProductType`, `StockTracking`, `ExpirationControl`),
 * como el nombre plano de cada enum. No hay un «tipo de producto» con 40 combinaciones: cada eje
 * responde una pregunta distinta y la pantalla deshabilita —nunca oculta— lo que la combinación
 * no permite. Los defaults son el producto de siempre: `SIMPLE` + `QUANTITY` + `NONE`.
 */
export const PRODUCT_TYPES = ['SIMPLE', 'KIT', 'SERVICE'] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export const DEFAULT_PRODUCT_TYPE: ProductType = 'SIMPLE';

/** Con qué granularidad se controla la existencia. `NONE` saca al producto del inventario entero. */
export const STOCK_TRACKING_MODES = ['NONE', 'QUANTITY', 'BATCH', 'SERIAL'] as const;

export type StockTracking = (typeof STOCK_TRACKING_MODES)[number];

export const DEFAULT_STOCK_TRACKING: StockTracking = 'QUANTITY';

/** Si se pide vencimiento al ingresar stock. Sólo tiene sentido con `BATCH` o `SERIAL`. */
export const EXPIRATION_CONTROLS = ['NONE', 'OPTIONAL', 'REQUIRED'] as const;

export type ExpirationControl = (typeof EXPIRATION_CONTROLS)[number];

export const DEFAULT_EXPIRATION_CONTROL: ExpirationControl = 'NONE';

/** Coerción defensiva: un valor desconocido del backend cae al default en vez de romper. */
export function toProductType(value: string | null | undefined): ProductType {
  return PRODUCT_TYPES.find((type) => type === value) ?? DEFAULT_PRODUCT_TYPE;
}

export function toStockTracking(value: string | null | undefined): StockTracking {
  return STOCK_TRACKING_MODES.find((mode) => mode === value) ?? DEFAULT_STOCK_TRACKING;
}

export function toExpirationControl(value: string | null | undefined): ExpirationControl {
  return EXPIRATION_CONTROLS.find((control) => control === value) ?? DEFAULT_EXPIRATION_CONTROL;
}

/** Un kit, en cualquiera de sus dos modos. Es el que tiene composición. */
export function isKit(type: ProductType): boolean {
  return type === 'KIT';
}

/**
 * El kit **virtual**: el que se explota al vender (RN-08) y no lleva saldo propio.
 *
 * Está separado de {@link isKit} porque son dos preguntas distintas: un kit armado es un `KIT` que
 * en el POS y en el stock se comporta como una mercadería cualquiera (RN-22), y confundirlas lo
 * dejaría sin solapa de stock y explotándose al vender. La **compra** ya no las distingue: no se
 * compra ningún kit, y ahí la pregunta es {@link isKit}.
 */
export function isVirtualKit(type: ProductType, mode: KitMode | null | undefined): boolean {
  return isKit(type) && toKitMode(mode) === 'EXPLODE';
}

/**
 * Los dos estados con nombre del filtro de circulación del listado. El tercero que el select ofrece
 * —«todos»— es la **ausencia** de filtro y viaja como `null`, así que no está acá.
 *
 * Los dos no son complementarios, y ahí está el punto de que el select tenga tres opciones: `onSale`
 * es lo que se vende (`is_for_sale`), `discontinued` es lo que no se compra **ni** se vende —la
 * definición del ADR 0001— y en el medio queda el producto que se compra y no se vende: el insumo,
 * el componente de kit. Ese no está retirado y tampoco se ofrece en el mostrador, así que no entra
 * en ninguno de los dos; «todos» es donde aparece.
 *
 * Los **archivados** no son un estado de este filtro: el paginado del Core no los devuelve nunca.
 */
export const PRODUCT_SALE_STATUSES = ['onSale', 'discontinued'] as const;

export type ProductSaleStatus = (typeof PRODUCT_SALE_STATUSES)[number];

/**
 * Qué bandera de circulación exige un estado, y con qué valor.
 *
 * Es la **única** definición de la regla. La necesitan dos lugares que hablan dialectos distintos —el
 * paginador de la grilla, que filtra por clave lógica, y la consulta de variantes de un modelo, que
 * arma el `filtros` del backend a mano— y tenerla escrita dos veces era la forma de que expandir un
 * modelo terminara contradiciendo al filtro de arriba.
 */
export interface SaleStatusFlag {
  /** La clave del `filterConfig` del paginador. */
  filterKey: 'forSale' | 'forPurchase';
  /** La columna real de `products`, para la consulta que no pasa por el paginador. */
  columna: 'is_for_sale' | 'is_for_purchase';
  value: boolean;
}

/**
 * Las condiciones que impone un estado, combinadas con **AND**. Vacío en «todos», que es la ausencia
 * de filtro.
 *
 * `discontinued` pide las dos apagadas porque ésa es la definición (ADR 0001); `onSale` pide sólo la
 * de venta, así que no es su complemento — entre los dos queda el producto que se compra y no se
 * vende, que aparece únicamente en «todos».
 */
export function saleStatusFlagsOf(status: ProductSaleStatus | null): readonly SaleStatusFlag[] {
  if (status === 'onSale') {
    return [{ filterKey: 'forSale', columna: 'is_for_sale', value: true }];
  }
  if (status === 'discontinued') {
    return [
      { filterKey: 'forSale', columna: 'is_for_sale', value: false },
      { filterKey: 'forPurchase', columna: 'is_for_purchase', value: false },
    ];
  }
  return [];
}

/** El listado abre mostrando lo que se vende: el catálogo lleno de productos muertos es el defecto que el filtro viene a arreglar. */
export const DEFAULT_PRODUCT_SALE_STATUS: ProductSaleStatus = 'onSale';

/**
 * El producto **discontinuado**: no se compra ni se vende, pero sigue en el catálogo (ADR 0001).
 *
 * Son las **dos** banderas apagadas, igual que `ProductCatalogState.of` del backend. Con una sola
 * apagada no hay nada que marcar: el que se dejó de comprar y se sigue vendiendo es un activo en
 * liquidación, y el que se compra y no se vende es un insumo — ninguno de los dos salió del catálogo.
 *
 * Ausente no cuenta como apagada: un paginado que no informa las banderas no convierte el catálogo
 * entero en discontinuado.
 */
export function isDiscontinued(product: ProductPaginateDto): boolean {
  return product.isForSale === false && product.isForPurchase === false;
}

/**
 * El `status` con el que el Core marca un registro archivado: su borrado lógico.
 *
 * El `-2` —la baja temporal— **no** cuenta: ése se reactiva, y su ficha se sigue editando. Sólo el
 * `-1` es la salida definitiva, la que no se deshace (ADR 0001).
 */
const ARCHIVED_PRODUCT_STATUS = -1;

/**
 * El producto **archivado**: salió del catálogo y no vuelve.
 *
 * Es lo que pone su ficha en sólo lectura. `GET /product/uuid/{uuid}` la devuelve igual —archivar no
 * la borra, y quien llega desde el histórico necesita poder abrirla—, pero guardarla es un `400
 * PRODUCT_ARCHIVED_READ_ONLY`: sin esto la pantalla ofrecía un botón que sólo podía fallar.
 *
 * **Ausente no es archivado.** Un backend anterior a `6.9.0` no informa `status` en el detalle, y
 * abrir en sólo lectura por las dudas dejaría sin editar al catálogo entero.
 */
export function isArchivedProduct(product: { status?: number | null }): boolean {
  return product.status === ARCHIVED_PRODUCT_STATUS;
}

/** El kit **armado**: tiene existencias propias y se produce con un documento (§6.6). */
export function isAssembledKit(type: ProductType, mode: KitMode | null | undefined): boolean {
  return isKit(type) && toKitMode(mode) === 'ASSEMBLE';
}

/**
 * Quién fuerza `stock_tracking = NONE` (RN-01): el servicio siempre, y el kit **sólo mientras sea
 * virtual**. El armado conserva el eje entero — una bandeja lleva partida y vencimiento, una PC
 * armada lleva su serie (RN-22).
 */
export function typeRequiresNoStock(type: ProductType, mode?: KitMode | null): boolean {
  return type === 'SERVICE' || isVirtualKit(type, mode);
}

/** Sólo las partidas y las series tienen dónde guardar un vencimiento (RN-03). */
export function trackingSupportsExpiration(tracking: StockTracking): boolean {
  return tracking === 'BATCH' || tracking === 'SERIAL';
}

/** Una fila de la grilla de códigos de barras (`ProductBarcodeDTO`). */
export interface ProductBarcodeDto {
  uuid?: string | null;
  barcode: string;
  /** El principal es el que se copia a `barcode` y el que muestra la grilla de productos. */
  isPrimary?: boolean | null;
}

/**
 * Una fila de la grilla de empaques (`ProductPackagingDTO`): «Caja x 12», «Bulto x 100».
 *
 * El empaque **no es un producto** (RN-16): no tiene stock ni precio propio. Es un factor de
 * conversión que aplica quien carga la línea, y el saldo se sigue llevando en la unidad base.
 *
 * La fila se identifica por `uuid`, no por el nombre: renombrar «Caja x 12» conserva la fila —y con
 * ella el código de barras que la lee—. `barcode` es el código de la caja: vive en
 * `product_barcodes` apuntando al empaque, y se edita acá porque es un dato del empaque.
 */
export interface ProductPackagingDto {
  uuid?: string | null;
  name: string;
  /** Unidades base que contiene. Tiene que ser `> 0` (`PACKAGING_FACTOR_INVALID`). */
  factor: number;
  /** Con cuál arranca la línea de compra. Uno por producto como máximo. */
  isPurchaseDefault?: boolean | null;
  /** Con cuál arranca la línea de venta. Uno por producto como máximo. */
  isSaleDefault?: boolean | null;
  barcode?: string | null;
}

/**
 * De dónde sale el precio de un kit (`KitPricing`). No es un eje del producto: es una propiedad del
 * kit, y lo que cambia es **quién decide el precio**. El prorrateo entre los componentes ocurre
 * siempre (RN-09), en los dos modos.
 */
export const KIT_PRICINGS = ['OWN_PRICE', 'SUM_COMPONENTS'] as const;

export type KitPricing = (typeof KIT_PRICINGS)[number];

export const DEFAULT_KIT_PRICING: KitPricing = 'OWN_PRICE';

export function toKitPricing(value: string | null | undefined): KitPricing {
  return KIT_PRICINGS.find((pricing) => pricing === value) ?? DEFAULT_KIT_PRICING;
}

/**
 * Los dos modos del kit (`KitMode`), y **la diferencia es cuándo se consume el componente**.
 *
 * La regla con la que el usuario elige cabe en una línea: *si el conjunto existe sólo en el ticket
 * es `EXPLODE`; si existe en un estante, `ASSEMBLE`*.
 *
 * Cambia el resto de la pantalla, y por eso el selector va arriba de todo en la solapa Componentes:
 * con `ASSEMBLE` el producto conserva sus solapas de stock y «disponible» pasa a leerse «podés
 * armar».
 */
export const KIT_MODES = ['EXPLODE', 'ASSEMBLE'] as const;

export type KitMode = (typeof KIT_MODES)[number];

/** El default es el virtual: es lo que hacía todo kit antes de la Entrega G (RN-21). */
export const DEFAULT_KIT_MODE: KitMode = 'EXPLODE';

export function toKitMode(value: string | null | undefined): KitMode {
  return KIT_MODES.find((mode) => mode === value) ?? DEFAULT_KIT_MODE;
}

/**
 * Una fila de la composición de un kit (`ProductKitItemDTO`): qué producto entra y cuántas
 * unidades.
 *
 * El kit virtual **no tiene stock propio**: existe mientras existan sus componentes. Los campos de
 * sólo lectura son los que hacen legible esa disponibilidad derivada sin pedir el stock producto
 * por producto: {@link stock} es el saldo del componente en la sucursal activa y
 * {@link availableKits} para cuántos kits alcanza **esa fila sola**. El mínimo de esa columna es el
 * disponible del kit, y la fila que lo marca es la que manda (RN-07).
 */
export interface ProductKitItemDto {
  uuid?: string | null;
  component: UuidNameRef;
  quantity: number;
  displayOrder?: number | null;
  componentSku?: string | null;
  /** `SIMPLE` | `KIT` | `SERVICE`. */
  componentType?: string | null;
  /** `NONE` | `QUANTITY` | `BATCH` | `SERIAL`. */
  componentStockTracking?: string | null;
  /** Precio del componente en la lista principal: el peso con el que se prorratea (RN-09). */
  listPrice?: number | null;
  /** Saldo en la sucursal activa; `null` en un componente que no lleva stock. */
  stock?: number | null;
  /** `⌊stock / quantity⌋`; `null` en los componentes que no limitan. */
  availableKits?: number | null;
  /** Si la fila entra en el mínimo. Un `SERVICE` **no limita** la disponibilidad (RN-07). */
  limitsAvailability?: boolean | null;
  /**
   * Costo del componente en la sucursal, con el método de costeo vigente. Es la columna «costo
   * actual» del wireframe `1r` y el sumando del costo estimado del terminado.
   */
  componentCost?: number | null;
}

/** Una fila de la composición tal como viaja en el `/save`: el resto lo deriva el backend. */
export interface ProductKitItemPayload {
  uuid?: string;
  component: { uuid: string };
  quantity: number;
  displayOrder: number;
}

/** Row of `GET /category/attributes/{uuid}` (`CategoryAttributeDTO`). */
export interface CategoryAttributeDto {
  uuid: string;
  name: string;
  /** One of `ATTRIBUTE_VALUE_TYPES` (`core/attributes`); anything else renders as free text. */
  type: string;
  /** Level of the tree the attribute is inherited from. */
  category?: UuidNameRef | null;
}

/** One attribute value of a product (`ProductCategoryAttributeValueDTO`). */
export interface ProductCategoryAttributeValueDto {
  attributeUuid: string;
  value: string;
}

/** Body of `POST /product/save` (`ProductDTO`, only the fields the form owns). */
export interface ProductSavePayload {
  uuid?: string;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
  name: string;
  sku: string | null;
  /**
   * La grilla completa de códigos: es la verdad para el backend, que agrega, quita y marca el
   * principal a partir de ella. El campo único `barcode` ya no viaja: lo deriva el backend.
   */
  barcodes: ProductBarcodeDto[];
  /**
   * La grilla completa de empaques, con la misma semántica que {@link barcodes}: es la verdad para
   * el backend. Cada fila reenvía su `uuid` cuando ya existía, que es lo que conserva la fila —y su
   * código de barras— al renombrarla.
   */
  packagings: ProductPackagingDto[];
  unitMeasure: string;
  taxRate: number;
  lowStock: number | null;
  optimalStock: number | null;
  type: ProductType;
  stockTracking: StockTracking;
  expirationControl: ExpirationControl;
  expirationAlertDays: number | null;
  standardCost: number | null;
  /** El producto se pesa en balanza. Sólo se acepta con una unidad que admita decimales. */
  isWeighable: boolean;
  /** Código interno de balanza, único por empresa. **No** es un código de barras (RN-18). */
  scaleCode: string | null;
  /**
   * La grilla completa de componentes del kit, con la misma semántica que {@link barcodes}: es la
   * verdad para el backend. Sólo viaja con `type = KIT` —en otro producto el backend responde
   * `KIT_ITEMS_NOT_APPLICABLE`— y un kit sin filas es `KIT_REQUIRES_COMPONENTS`.
   *
   * Mandarla exige el permiso `product.kit_edit` además del de edición: cambiar la composición
   * cambia lo que descuenta cada venta del combo.
   */
  kitItems?: ProductKitItemPayload[];
  /** Uno de {@link KIT_PRICINGS}. Sólo viaja con `type = KIT`. */
  kitPricing?: KitPricing;
  /** Uno de {@link KIT_MODES}. Sólo viaja con `type = KIT`; `null` en el resto del catálogo. */
  kitMode?: KitMode | null;
  /** Descuento sobre la suma de los componentes (0..100). Sólo con `SUM_COMPONENTS`. */
  kitDiscountPercent?: number | null;
  isForSale: boolean;
  isForPurchase: boolean;
  brand: { uuid: string } | null;
  category: { uuid: string } | null;
  categoryAttributes?: ProductCategoryAttributeValueDto[];
  /** Only the lists with a price typed in: the backend upserts what it receives. */
  priceListEntries?: ProductPriceListEntryDto[];
  /**
   * Sucursales en las que se ofrece el producto. Se omite cuando el usuario no tiene
   * `product.branch_assign`: mandarla sin el permiso es un 403, y `null` deja la relación intacta.
   */
  branches?: { uuid: string }[];
  /**
   * Proveedores a los que se le compra el producto. Misma semántica que {@link branches} —`null`
   * deja la relación intacta, `[]` desvincula a todos—, pero sin permiso propio: alcanza con el de
   * edición. Se omite cuando el usuario no puede listar proveedores (`supplier.view`), porque sin
   * la lista no hay forma de saber cuáles reenviar.
   */
  suppliers?: { uuid: string }[];
}

/**
 * Métodos de costeo con los que una sucursal resuelve el costo de sus productos
 * (`BranchConfigService.costMethod`). Viajan como el nombre plano del enum.
 */
export const COST_METHODS = ['FIFO', 'LIFO', 'AVERAGE'] as const;

export type CostMethod = (typeof COST_METHODS)[number];

/** Response of `POST /product/save` (`ProductDTO`), reduced to what the screen uses. */
export interface ProductDto extends Versioned {
  uuid: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unitMeasure?: string | null;
  /** Decimales que admite una cantidad de este producto. Ver {@link ProductPaginateDto}. */
  unitDecimalPlaces?: number | null;
  brand?: UuidNameRef | null;
  category?: UuidNameRef | null;
  taxRate?: number | null;
  /**
   * Costo unitario en la sucursal activa, leído de la lista reservada Costo. Es neto —el impuesto
   * se suma después, igual que en la venta— y es `null` mientras el producto no haya tenido una
   * entrada de stock con costo en esa sucursal.
   */
  cost?: number | null;
  /** Uno de {@link COST_METHODS}: con qué método la sucursal calculó ese `cost`. */
  costMethod?: string | null;
  lowStock?: number | null;
  optimalStock?: number | null;
  /** Los ejes del producto. Un producto anterior a los ejes viene con los defaults. */
  type?: string | null;
  stockTracking?: string | null;
  expirationControl?: string | null;
  expirationAlertDays?: number | null;
  /** Costo declarado: es el `cost` de un producto sin stock, informativo para el resto. */
  standardCost?: number | null;
  /** `false` cuando `stockTracking` es `NONE`: no hay solapa Stock ni saldo que mostrar. */
  tracksStock?: boolean | null;
  /**
   * Saldo del producto en la sucursal activa. `null` cuando no lleva existencias.
   *
   * Lo usa el selector de modo del kit: es lo que RN-28 mira para trabar la vuelta a virtual, y
   * poder decir **cuántas** unidades armadas lo impiden en vez de un «no se puede» pelado.
   */
  totalStock?: number | null;
  /**
   * Todos los códigos con los que se lee el producto **suelto**, el principal primero. Los de
   * empaque no entran acá: vienen en {@link packagings}, que es donde se editan.
   */
  barcodes?: ProductBarcodeDto[] | null;
  /** Empaques declarados. No agregan un saldo: el stock se lleva en la unidad base (RN-16). */
  packagings?: ProductPackagingDto[] | null;
  /** Composición del kit, con el stock de cada componente y para cuántos combos alcanza. */
  kitItems?: ProductKitItemDto[] | null;
  /** Uno de {@link KIT_PRICINGS}; `null` en un producto que no es kit. */
  kitPricing?: string | null;
  /** Uno de {@link KIT_MODES}; `null` en un producto que no es kit (se lee como `EXPLODE`). */
  kitMode?: string | null;
  /**
   * Costo de armar **uno** con la composición y los costos de hoy, sin adicionales. Derivado.
   *
   * No es `cost`: en un kit armado ése es el costo real **congelado** de las unidades que hay en el
   * estante (RN-24). Los dos juntos dicen si la receta se encareció desde el último armado.
   */
  kitCompositionCost?: number | null;
  /** Descuento sobre la suma de los componentes, en porcentaje. Sólo con `SUM_COMPONENTS`. */
  kitDiscountPercent?: number | null;
  /**
   * Cuántos kits se pueden armar con el stock de hoy: `mín ⌊stock(componente) / cantidad⌋` (RN-07).
   * Derivado, no persistido — el kit virtual **no tiene** saldo propio, así que `totalStock` viene
   * en `null` como en cualquier producto sin control de existencias.
   */
  kitAvailability?: number | null;
  /** Precio calculado en el modo `SUM_COMPONENTS`; `null` en `OWN_PRICE`. */
  kitComputedPrice?: number | null;
  isWeighable?: boolean | null;
  scaleCode?: string | null;
  isForSale?: boolean | null;
  isForPurchase?: boolean | null;
  /**
   * El modelo que agrupa a esta variante, o ausente en un producto suelto (RN-11). De sólo
   * lectura: la pertenencia al modelo se define en la matriz, no en la ficha.
   */
  model?: UuidNameRef | null;
  branches?: UuidNameRef[] | null;
  /** Proveedores vinculados, con el uuid del **rol** `SUPPLIER`. Los de baja no vienen. */
  suppliers?: UuidNameRef[] | null;
  categoryAttributes?: ProductCategoryAttributeValueDto[] | null;
  priceListEntries?: ProductPriceListEntryDto[] | null;
  status?: number;
}

/** Alta del producto. */
export const PRODUCT_CREATE_PERMISSION = Permissions.productCreate;

/** Edición del producto: el `save` con `uuid` lo exige en lugar de `product.create`. */
export const PRODUCT_EDIT_PERMISSION = Permissions.productEdit;

/**
 * Archivar el producto: el `DELETE /product/{uuid}` del Core. Es **irreversible** —revivir un
 * registro eliminado está prohibido en `AbstractEntity.setAbstract`— y por eso no comparte permiso
 * con `product.edit`, que es con lo que se discontinúa (ADR 0001).
 */
export const PRODUCT_DELETE_PERMISSION = Permissions.productDelete;

/**
 * Habilita la grilla de sucursales del producto. Es el mismo permiso que abre el catálogo completo
 * (`/product/paginate-all`), porque no se puede vincular un producto a una sucursal sin verlo antes.
 */
export const PRODUCT_BRANCH_ASSIGN_PERMISSION = Permissions.productBranchAssign;

/**
 * Habilita la sección de proveedores del producto. No es el permiso para vincularlos —eso lo cubre
 * `product.edit`— sino el de **listarlos**: sin él, `POST /party/supplier/paginate` es un 403 y no
 * habría opciones que ofrecer ni nombres con los que mostrar las que ya están.
 */
export const SUPPLIER_VIEW_PERMISSION = Permissions.supplierView;

/**
 * Permiso que exige `GET /price-rule/product/{uuid}`. Sin él la consulta es un 403, así que la
 * pantalla ni la intenta y los precios quedan editables: la regla la sigue aplicando el backend en
 * cada compra, pero la pantalla no tiene cómo saber que existe.
 */
export const PRICE_RULE_VIEW_PERMISSION = Permissions.priceRuleView;

/**
 * Habilita la grilla de componentes del kit. Se suma a `product.edit`: cambiar la composición
 * cambia lo que descuenta cada venta del combo (RN-08), y el backend responde `403` si el payload
 * trae `kitItems` sin este permiso. Sin él la solapa se muestra en modo lectura y la grilla no
 * viaja, igual que los proveedores sin `supplier.view`.
 */
export const PRODUCT_KIT_EDIT_PERMISSION = Permissions.productKitEdit;

/**
 * Listas que la regla recalcula en la sucursal activa → porcentaje con el que lo hace. Son las que
 * el formulario no deja editar a mano: su precio sale del costo, no de lo que se escriba acá.
 */
export function rulePercentByPriceListUuid(
  rule: ProductPriceRuleDto | null,
): ReadonlyMap<string, number | null> {
  const byPriceListUuid = new Map<string, number | null>();

  for (const row of rule?.priceLists ?? []) {
    if (row.priceList?.uuid) {
      byPriceListUuid.set(row.priceList.uuid, row.percent ?? null);
    }
  }

  return byPriceListUuid;
}

/**
 * Tramo del semáforo de stock de la grilla, de peor a mejor:
 *
 * - `out` — sin stock. Es un hecho, no depende de los umbrales.
 * - `low` — llegó al umbral de reposición (`lowStock`) o lo perforó: hay que comprar.
 * - `belowOptimal` — repuesto, pero todavía por debajo del objetivo (`optimalStock`).
 * - `optimal` — alcanzó el objetivo.
 * - `unknown` — el producto no tiene ningún umbral cargado: no hay contra qué comparar y la celda
 *   se queda neutra en lugar de inventar un verde.
 * - `notTracked` — el producto no lleva control de existencias (`stockTracking = NONE`): un
 *   servicio, un kit virtual, mercadería que no se cuenta. No es que haya cero: la pregunta no
 *   aplica, y la celda lo dice en vez de pintarlo de rojo.
 */
export type StockLevel = 'out' | 'low' | 'belowOptimal' | 'optimal' | 'unknown' | 'notTracked';

/**
 * Ambos umbrales son opcionales y el formulario garantiza `lowStock <= optimalStock`, así que
 * alcanza con evaluarlos de menor a mayor y quedarse con el primero que se cumple. Con uno solo
 * cargado el tramo del otro simplemente no existe: sólo `lowStock` deja el catálogo en «bajo /
 * óptimo», y sólo `optimalStock` en «por debajo / óptimo».
 */
export function resolveStockLevel(product: ProductPaginateDto): StockLevel {
  if (product.tracksStock === false || product.stockTracking === 'NONE') {
    return 'notTracked';
  }

  const stock = product.totalStock ?? 0;

  if (stock <= 0) {
    return 'out';
  }

  const lowStock = product.lowStock ?? null;
  const optimalStock = product.optimalStock ?? null;

  if (lowStock === null && optimalStock === null) {
    return 'unknown';
  }

  if (lowStock !== null && stock <= lowStock) {
    return 'low';
  }

  if (optimalStock !== null && stock < optimalStock) {
    return 'belowOptimal';
  }

  return 'optimal';
}

/** Price of `priceListUuid` for the row, or `null` when the list has no price. */
export function priceFor(product: ProductPaginateDto, priceListUuid: string): number | null {
  const entry = product.priceListEntries?.find((item) => item.priceListUuid === priceListUuid);
  return entry?.price ?? null;
}

/** Depth-first flattening of the category tree into select options. */
export function toCategoryOptions(
  nodes: readonly CategoryTreeNodeDto[],
  depth = 0,
  parentPath = '',
): CategoryOption[] {
  const options: CategoryOption[] = [];

  for (const node of nodes) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    options.push({
      uuid: node.uuid,
      name: node.name,
      depth,
      path,
      subtreeUuids: collectSubtreeUuids(node),
    });
    options.push(...toCategoryOptions(node.subCategories ?? [], depth + 1, path));
  }

  return options;
}

function collectSubtreeUuids(node: CategoryTreeNodeDto): string[] {
  const uuids = [node.uuid];

  for (const child of node.subCategories ?? []) {
    uuids.push(...collectSubtreeUuids(child));
  }

  return uuids;
}
