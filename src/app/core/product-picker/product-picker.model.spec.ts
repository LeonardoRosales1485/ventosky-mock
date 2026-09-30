import { describe, expect, it } from 'vitest';
import {
  PickerCategoryTreeNode,
  SUPPLIER_PICKER_RELATIONS,
  availabilityFilterGroups,
  notKitFilter,
  trackedOnlyFilter,
  availabilityPresetFilter,
  pickerPriceFor,
  supplierFilterGroups,
  toPickerCategoryOptions,
} from './product-picker.model';

const TREE: PickerCategoryTreeNode[] = [
  {
    uuid: 'bebidas',
    name: 'Bebidas',
    subCategories: [
      { uuid: 'gaseosas', name: 'Gaseosas', subCategories: null },
      {
        uuid: 'alcoholicas',
        name: 'Alcohólicas',
        subCategories: [{ uuid: 'cervezas', name: 'Cervezas', subCategories: null }],
      },
    ],
  },
  { uuid: 'limpieza', name: 'Limpieza', subCategories: null },
];

describe('toPickerCategoryOptions', () => {
  it('flattens the tree depth-first, keeping depth and full path', () => {
    expect(toPickerCategoryOptions(TREE).map((option) => [option.uuid, option.depth, option.path])) //
      .toEqual([
        ['bebidas', 0, 'Bebidas'],
        ['gaseosas', 1, 'Bebidas / Gaseosas'],
        ['alcoholicas', 1, 'Bebidas / Alcohólicas'],
        ['cervezas', 2, 'Bebidas / Alcohólicas / Cervezas'],
        ['limpieza', 0, 'Limpieza'],
      ]);
  });

  /** Filtrar por una categoría trae también las de sus hijas: es lo que el filtro `IN` recibe. */
  it('carries the whole subtree of each option', () => {
    const options = toPickerCategoryOptions(TREE);

    expect(options[0].subtreeUuids).toEqual([
      'bebidas',
      'gaseosas',
      'alcoholicas',
      'cervezas',
    ]);
    expect(options.at(-1)?.subtreeUuids).toEqual(['limpieza']);
  });
});

describe('availabilityPresetFilter', () => {
  /**
   * `is_for_sale` es nullable y sin default: un `= true` a secas escondería los productos viejos
   * que nunca tuvieron el flag cargado, que el resto del front sí ofrece.
   */
  it('lets a product with the flag unset through', () => {
    expect(availabilityPresetFilter('sale')).toEqual([
      { tabla: 't', columna: 'is_for_sale', operacion: '=', valor: 'true' },
      { tabla: 't', columna: 'is_for_sale', operacion: 'is null', valor: '' },
    ]);
  });

  it('filters by the purchase flag when the picker is opened for a purchase', () => {
    expect(availabilityPresetFilter('purchase')?.[0].columna).toBe('is_for_purchase');
  });

  it('does not filter at all when any product is acceptable', () => {
    expect(availabilityPresetFilter('any')).toBeUndefined();
  });
});

describe('availabilityFilterGroups', () => {
  /**
   * Un kit no se compra en ninguno de sus dos modos (`KIT_NOT_PURCHASABLE`). La exclusión es un
   * grupo aparte porque se combina con AND: metida en el de `is_for_purchase` sería una
   * alternativa y dejaría pasar todo.
   */
  it('adds the kit exclusion as its own AND-ed group when buying', () => {
    expect(availabilityFilterGroups('purchase')).toEqual([
      [
        { tabla: 't', columna: 'is_for_purchase', operacion: '=', valor: 'true' },
        { tabla: 't', columna: 'is_for_purchase', operacion: 'is null', valor: '' },
      ],
      [{ tabla: 't', columna: 'type', operacion: '!=', valor: 'KIT' }],
    ]);
  });

  /** El kit se vende —es su razón de ser—, así que la venta lleva un grupo y no dos. */
  it('does not exclude any kit when selling', () => {
    const groups = availabilityFilterGroups('sale');

    expect(groups).toHaveLength(1);
    expect(groups[0][0].columna).toBe('is_for_sale');
  });

  it('does not filter at all when any product is acceptable', () => {
    expect(availabilityFilterGroups('any')).toEqual([]);
  });

  /**
   * El traslado abre el selector con `any` —un insumo se traslada aunque no se venda ni se compre—
   * y aun así no puede ofrecer lo que no participa del inventario (RN-06): las dos preguntas son
   * ortogonales, así que `trackedOnly` es su propio grupo.
   */
  it('excludes what has no stock control when the screen moves stock', () => {
    expect(availabilityFilterGroups('any', true)).toEqual([
      [{ tabla: 't', columna: 'stock_tracking', operacion: '!=', valor: 'NONE' }],
    ]);
  });

  /** Mira el eje y no el tipo, que es lo que deja pasar al kit armado: tiene saldo propio (RN-22). */
  it('filters by the axis and not by the type, so an assembled kit still shows up', () => {
    expect(trackedOnlyFilter()).toEqual([
      { tabla: 't', columna: 'stock_tracking', operacion: '!=', valor: 'NONE' },
    ]);
  });

  it('combines both exclusions when buying from a stock-moving screen', () => {
    const groups = availabilityFilterGroups('purchase', true);

    expect(groups).toHaveLength(3);
    expect(groups[1]).toEqual(notKitFilter());
    expect(groups[2]).toEqual(trackedOnlyFilter());
  });
});

describe('supplierFilterGroups', () => {
  /**
   * Dos grupos y no uno: los grupos se combinan con AND, así que meterlos juntos los volvería un OR
   * y un vínculo dado de baja alcanzaría para dejar pasar el producto.
   */
  it('asks for the supplier and for the link being active, as two AND-ed groups', () => {
    expect(supplierFilterGroups('supplier-uuid')).toEqual([
      [{ tabla: 'party_roles', columna: 'uuid', operacion: '=', valor: 'supplier-uuid' }],
      [{ tabla: 'product_suppliers', columna: 'status', operacion: '=', valor: '0' }],
    ]);
  });

  /** El filtro nombra `party_roles` y `product_suppliers`: sin los JOIN no hay de dónde leerlas. */
  it('names the tables the join chain reaches, in the order that chains them', () => {
    expect(SUPPLIER_PICKER_RELATIONS.map((relacion) => relacion.hastaTabla)).toEqual([
      'product_suppliers',
      'party_roles',
    ]);
    expect(SUPPLIER_PICKER_RELATIONS.map((relacion) => relacion.tipo)).toEqual(['inner', 'inner']);
    expect(SUPPLIER_PICKER_RELATIONS[0].desdeTabla).toBe('t');
    expect(SUPPLIER_PICKER_RELATIONS[1].desdeTabla).toBe('product_suppliers');
  });
});

describe('pickerPriceFor', () => {
  const product = {
    uuid: 'product-uuid',
    name: 'Zapatillas',
    priceListEntries: [
      { priceListUuid: 'principal', price: 45000 },
      { priceListUuid: 'mayorista', price: null },
    ],
  };

  it('reads the price of the given list', () => {
    expect(pickerPriceFor(product, 'principal')).toBe(45000);
  });

  /** Sin precio en la lista no es precio cero: la celda queda vacía. */
  it('returns null for a list without a price and for a list not listed at all', () => {
    expect(pickerPriceFor(product, 'mayorista')).toBeNull();
    expect(pickerPriceFor(product, 'otra')).toBeNull();
  });
});
