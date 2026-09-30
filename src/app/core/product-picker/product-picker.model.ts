import { PaginateFiltro, PaginateRelacion } from '../paginate';

/** `UuidNameDTO`: la referencia mínima con la que viajan marca y categoría en el paginado. */
export interface PickerUuidNameRef {
  uuid: string;
  name: string;
}

/** Precio del producto en una lista, en la sucursal activa (`ProductPriceListEntryDTO`). */
export interface PickerPriceListEntry {
  priceListUuid: string;
  price: number | null;
}

/**
 * Producto tal como lo devuelve el paginado operativo (`POST /product/paginate`, `ProductPaginateDTO`),
 * ya acotado por el backend a la sucursal activa (`X-Branch-Uuid`) y con el stock y los precios de
 * esa sucursal.
 *
 * Es deliberadamente el DTO crudo y no un modelo propio: quien abre el selector recibe la fila
 * entera y arma con ella lo que necesite —una línea de venta, una de compra— sin volver a pedirla.
 */
export interface PickerProduct {
  uuid: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  /** Nombre del enum `UnitMeasure`: UNIT, KILOGRAM, LITER, … */
  unitMeasure?: string | null;
  /**
   * Decimales que admite una cantidad de este producto, derivados de la unidad. `0` sólo acepta
   * enteros; `null` es el producto sin unidad declarada. Ver `core/product/quantity-precision.ts`.
   */
  unitDecimalPlaces?: number | null;
  brand?: PickerUuidNameRef | null;
  category?: PickerUuidNameRef | null;
  taxRate?: number | null;
  isForSale?: boolean | null;
  isForPurchase?: boolean | null;
  /**
   * Naturaleza del producto (`SIMPLE` | `KIT` | `SERVICE`) y eje de existencias
   * (`NONE` | `QUANTITY` | `BATCH` | `SERIAL`), tal como los devuelve el paginado.
   *
   * `tracksStock` es el derivado que ya viene resuelto: con `false`, {@link totalStock} viaja en
   * `null` —no aplica— y no hay saldo que comparar. Lo usa la composición de un kit para distinguir
   * el componente que **no limita** la disponibilidad del que está agotado (RN-07).
   */
  type?: string | null;
  stockTracking?: string | null;
  tracksStock?: boolean | null;
  /**
   * Modo del kit (`EXPLODE` | `ASSEMBLE`), ausente fuera de un `type = KIT`. Es lo que separa al
   * combo —que se explota al vender y no tiene saldo— del **armado**, que es un producto con
   * existencias propias (RN-22). Quien elige del selector necesita distinguirlos: al POS le cambia
   * cómo dibuja la línea, y el armado sólo se puede producir con el segundo.
   */
  kitMode?: string | null;
  lowStock?: number | null;
  optimalStock?: number | null;
  /** Saldo en la sucursal activa. */
  totalStock?: number | null;
  priceListEntries?: PickerPriceListEntry[] | null;
  /**
   * El modelo que agrupa a esta variante, o ausente en un producto suelto (RN-11).
   *
   * Es lo que permite mostrar **el modelo una sola vez** en el buscador: doce variantes que inundan
   * la lista son doce filas que el operador tiene que leer para encontrar el talle. El modelo no es
   * agregable —no se vende (RN-12)—: al elegirlo se abre el selector de variante.
   */
  model?: PickerUuidNameRef | null;
  /** Qué valor fija la variante en cada eje: «Talle: M». Vacío en un producto sin modelo. */
  variantValues?: PickerVariantValue[] | null;
}

/** Un valor que la variante fija en un eje, tal como lo devuelve el paginado. */
export interface PickerVariantValue {
  optionValueUuid?: string;
  optionUuid?: string;
  /** «Talle». */
  optionName?: string;
  /** «M». */
  value?: string;
  code?: string | null;
}

/**
 * Qué mitad del catálogo ofrecer. Un producto puede estar habilitado sólo para comprar (un insumo,
 * un envase) o sólo para vender, y ofrecer el que no corresponde termina en un rechazo del backend.
 */
export type ProductPickerAvailability = 'sale' | 'purchase' | 'any';

/** El proveedor por el que se acota el catálogo, con su nombre para poder nombrar el filtro. */
export interface PickerSupplier {
  /** Uuid del rol `SUPPLIER`: el mismo que viaja como contraparte de la compra. */
  uuid: string;
  name: string;
}

/** Lo que el selector necesita saber de una lista de precios para darle una columna. */
export type PickerPriceList = PickerUuidNameRef;

/** Opciones con las que se abre el selector. */
export interface ProductPickerOptions {
  /** Por defecto `any`: el selector no supone para qué se está eligiendo. */
  availability?: ProductPickerAvailability;
  /**
   * Proveedor por el que arranca acotado el catálogo, o `undefined` para ofrecerlo entero. El
   * filtro se puede apagar desde el propio selector: el vínculo producto↔proveedor es informativo
   * y una compra a un proveedor que todavía no lo tiene cargado es perfectamente válida.
   */
  supplier?: PickerSupplier;
  /** Con qué texto abre el buscador; sirve para continuar lo que ya se había tipeado afuera. */
  initialSearch?: string;
  /**
   * Listas con las que armar las columnas de precio. Se pasan desde afuera —y no se leen acá—
   * porque quien abre el selector normalmente ya las tiene, y porque `price_list.view` es un
   * permiso que un cajero puede no tener: sin listas el selector simplemente no muestra precios.
   */
  priceLists?: readonly PickerPriceList[];
  /** Título del diálogo; por defecto el genérico del selector. */
  title?: string;
  /**
   * Ofrecer sólo productos que participan del inventario. Lo piden las pantallas que **mueven
   * stock** —traslado, ajuste—: un producto con `stock_tracking = NONE` no aparece en inventario,
   * valorización, ajustes ni transferencias (RN-06), así que ofrecerlo es ofrecer un error que
   * recién se ve al confirmar. Por defecto `false`: el selector no supone para qué se está
   * eligiendo, y el resto del catálogo lo sigue viendo entero.
   */
  trackedOnly?: boolean;
}

/** Lo que recibe el diálogo. Es el mismo contrato que {@link ProductPickerOptions}, ya resuelto. */
export interface ProductPickerDialogData extends ProductPickerOptions {
  availability: ProductPickerAvailability;
  priceLists: readonly PickerPriceList[];
}

/** Nodo del árbol de categorías (`GET /category/getAllTree`). Hoja ⇒ `subCategories: null`. */
export interface PickerCategoryTreeNode {
  uuid: string;
  name: string;
  subCategories: PickerCategoryTreeNode[] | null;
}

/** Opción del select de categorías: el árbol aplanado con su profundidad y su camino completo. */
export interface PickerCategoryOption {
  uuid: string;
  name: string;
  depth: number;
  /** `Bebidas / Gaseosas`, que es el tooltip de la opción. */
  path: string;
  /** La categoría y toda su descendencia, para el filtro `IN`. */
  subtreeUuids: string[];
}

/** Aplanado en profundidad del árbol de categorías. */
export function toPickerCategoryOptions(
  nodes: readonly PickerCategoryTreeNode[],
  depth = 0,
  parentPath = '',
): PickerCategoryOption[] {
  const options: PickerCategoryOption[] = [];

  for (const node of nodes) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    options.push({
      uuid: node.uuid,
      name: node.name,
      depth,
      path,
      subtreeUuids: collectSubtreeUuids(node),
    });
    options.push(...toPickerCategoryOptions(node.subCategories ?? [], depth + 1, path));
  }

  return options;
}

function collectSubtreeUuids(node: PickerCategoryTreeNode): string[] {
  const uuids = [node.uuid];

  for (const child of node.subCategories ?? []) {
    uuids.push(...collectSubtreeUuids(child));
  }

  return uuids;
}

/**
 * JOINs con los que el paginado llega desde el producto hasta el proveedor que lo provee.
 *
 * Se declaran siempre: el generador SQL del backend sólo emite el JOIN cuando un filtro o un orden
 * nombra la tabla, así que sin {@link supplierFilterGroups} no cuestan nada. La cadena es de dos
 * saltos porque el filtro llega con el **uuid** del proveedor y la tabla del vínculo guarda su id.
 */
export const SUPPLIER_PICKER_RELATIONS: readonly PaginateRelacion[] = [
  {
    tipo: 'inner',
    desdeTabla: 't',
    desdeColumna: 'id',
    hastaTabla: 'product_suppliers',
    hastaColumna: 'id_product',
  },
  {
    tipo: 'inner',
    desdeTabla: 'product_suppliers',
    desdeColumna: 'id_party_role',
    hastaTabla: 'party_roles',
    hastaColumna: 'id',
  },
];

/**
 * Grupos de filtro que dejan pasar sólo los productos vinculados a `supplierUuid`.
 *
 * Son dos grupos —se combinan con AND— y no uno: el segundo descarta los vínculos dados de baja,
 * que el JOIN traería igual. Van siempre acompañados de {@link SUPPLIER_PICKER_RELATIONS}; sin esos
 * JOIN el backend no sabe de qué tablas está hablando el filtro.
 */
export function supplierFilterGroups(supplierUuid: string): PaginateFiltro[][] {
  return [
    [{ tabla: 'party_roles', columna: 'uuid', operacion: '=', valor: supplierUuid }],
    [{ tabla: 'product_suppliers', columna: 'status', operacion: '=', valor: '0' }],
  ];
}

/**
 * Filtro con el que el paginado deja pasar sólo los productos de la mitad pedida del catálogo.
 *
 * Es un grupo `OR` y no una igualdad porque `is_for_sale` / `is_for_purchase` son columnas
 * nullables sin default: un producto viejo con el flag sin cargar se sigue ofreciendo, que es como
 * lo trata el resto del front (`isForSale !== false`).
 */
export function availabilityPresetFilter(
  availability: ProductPickerAvailability,
): PaginateFiltro[] | undefined {
  if (availability === 'any') {
    return undefined;
  }

  const columna = availability === 'sale' ? 'is_for_sale' : 'is_for_purchase';

  return [
    { tabla: 't', columna, operacion: '=', valor: 'true' },
    { tabla: 't', columna, operacion: 'is null', valor: '' },
  ];
}

/**
 * Filtro con el que el paginado deja fuera **cualquier kit**, sea virtual o armado.
 *
 * No mira `kit_mode` a propósito: los dos modos son igual de incomprables, y el paginado tampoco
 * trae el modo con el que distinguirlos.
 */
export function notKitFilter(): PaginateFiltro[] {
  return [{ tabla: 't', columna: 'type', operacion: '!=', valor: 'KIT' }];
}

/**
 * Si lo elegido es un kit **armado**: el que tiene existencias propias y se produce con un documento
 * de armado (RN-22). Un kit virtual contesta `false`, y con razón: no hay dónde dejar el terminado,
 * y el backend lo rechaza con `ASSEMBLY_PRODUCT_NOT_ASSEMBLABLE`.
 *
 * Un kit sin modo declarado —cargado antes de la Entrega G— se lee como virtual, igual que del otro
 * lado (`KitMode.orDefault`).
 */
export function isAssembledKitPick(product: Pick<PickerProduct, 'type' | 'kitMode'>): boolean {
  return product.type === 'KIT' && product.kitMode === 'ASSEMBLE';
}

/**
 * Si lo elegido es un kit **virtual**: el único que no puede ser componente de nada (§6.10). El
 * motivo es que no hay qué consumir —no existe en ningún estante—, y por eso la asimetría no es
 * arbitraria: el armado **sí** entra en los dos modos, que es la salida a la composición multinivel.
 */
export function isVirtualKitPick(product: Pick<PickerProduct, 'type' | 'kitMode'>): boolean {
  return product.type === 'KIT' && product.kitMode !== 'ASSEMBLE';
}

/**
 * Filtro con el que el paginado deja fuera lo que **no participa del inventario**.
 *
 * Mira el eje y no el tipo: un `SERVICE` y un kit `EXPLODE` están los dos forzados a
 * `stock_tracking = NONE` (RN-01), pero también hay mercadería común que el comercio eligió no
 * contar, y ninguna de las tres se puede trasladar ni ajustar (RN-06). El kit **armado** sí pasa:
 * tiene saldo propio y se mueve como cualquier producto (RN-22), que es exactamente la distinción
 * que `notKitFilter` no puede hacer y ésta sí.
 */
export function trackedOnlyFilter(): PaginateFiltro[] {
  return [{ tabla: 't', columna: 'stock_tracking', operacion: '!=', valor: 'NONE' }];
}

/**
 * Todos los grupos con los que el paginado acota el catálogo a lo que se puede cargar en la pantalla
 * que abrió el selector. Van como grupos separados porque se combinan con `AND`, y adentro de cada
 * uno con `OR`.
 *
 * La compra lleva uno más que la venta: **un kit no se compra** (`KIT_NOT_PURCHASABLE`), en ninguno
 * de sus dos modos. Es un conjunto que arma la empresa con productos suyos, así que al proveedor se
 * le compran las partes: el virtual no existe en ningún estante (§6.1) y el armado entra por su
 * documento de armado, que es el que consume los componentes (§6.6). Ofrecerlo acá sería ofrecer un
 * error recién al confirmar la compra.
 *
 * `trackedOnly` es la versión de lo mismo para las pantallas que mueven stock, y es ortogonal a la
 * mitad del catálogo: un traslado abre el selector con `any` —un insumo se traslada aunque no se
 * venda ni se compre— y aun así no puede ofrecer un servicio.
 */
export function availabilityFilterGroups(
  availability: ProductPickerAvailability,
  trackedOnly = false,
): PaginateFiltro[][] {
  const availabilityGroup = availabilityPresetFilter(availability);
  const groups = availabilityGroup ? [availabilityGroup] : [];

  if (availability === 'purchase') {
    groups.push(notKitFilter());
  }
  if (trackedOnly) {
    groups.push(trackedOnlyFilter());
  }

  return groups;
}

/** Precio del producto en `priceListUuid`, o `null` cuando esa lista no le puso precio. */
export function pickerPriceFor(product: PickerProduct, priceListUuid: string): number | null {
  const entry = product.priceListEntries?.find((item) => item.priceListUuid === priceListUuid);
  return entry?.price ?? null;
}
