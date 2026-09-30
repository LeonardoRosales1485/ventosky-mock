import { describe, expect, it } from 'vitest';
import {
  PackagingRef,
  ProductCodeLookup,
  baseQuantityOf,
  defaultPackagingOf,
  packageQuantityOf,
  readCarriesQuantity,
  scannedQuantityOf,
} from './product-lookup.model';

/** «Caja x 12»: el empaque del ejemplo del documento funcional. */
const BOX: PackagingRef = { uuid: 'pack-1', name: 'Caja x 12', factor: 12 };

function lookup(overrides: Partial<ProductCodeLookup<{ uuid: string }>>) {
  return {
    barcode: '7791234567890',
    product: { uuid: 'prod-1' },
    ...overrides,
  } as ProductCodeLookup<{ uuid: string }>;
}

describe('scannedQuantityOf', () => {
  it('carga una unidad cuando el código es el del producto suelto', () => {
    expect(scannedQuantityOf(lookup({ factor: 1 }))).toBe(1);
  });

  it('carga el factor del empaque: escanear la caja son 12 unidades', () => {
    expect(scannedQuantityOf(lookup({ factor: 12, packaging: BOX }))).toBe(12);
  });

  /**
   * Una etiqueta de balanza **ya trae** la cantidad pesada: multiplicarla por el factor sería
   * inventar mercadería. Por eso el peso gana, aunque el `factor` venga en `1`.
   */
  it('carga el peso que traía la etiqueta de balanza y no lo multiplica', () => {
    const reading = lookup({
      factor: 1,
      scale: {
        prefix: '2',
        scaleCode: '00123',
        rawValue: '01250',
        checkDigit: '7',
        valueType: 'WEIGHT',
        quantity: 1.25,
        amount: null,
      },
    });

    expect(scannedQuantityOf(reading)).toBe(1.25);
  });

  /**
   * La etiqueta que embebe **importe** no dice cuánto pesó: el precio lo pone la lista, no la
   * balanza, así que la línea entra con una unidad y el operador corrige.
   */
  it('cae a una unidad cuando la etiqueta trae importe y no peso', () => {
    const reading = lookup({
      factor: 1,
      scale: {
        prefix: '2',
        scaleCode: '00123',
        rawValue: '01250',
        checkDigit: '7',
        valueType: 'AMOUNT',
        quantity: null,
        amount: 12.5,
      },
    });

    expect(scannedQuantityOf(reading)).toBe(1);
  });

  it('cae a una unidad con un factor que no sirve', () => {
    expect(scannedQuantityOf(lookup({ factor: 0 }))).toBe(1);
    expect(scannedQuantityOf(lookup({ factor: null }))).toBe(1);
    expect(scannedQuantityOf(lookup({}))).toBe(1);
  });
});

describe('readCarriesQuantity', () => {
  /**
   * Distingue el «1 neutro» —el código del producto suelto, o una elección del buscador— de una
   * lectura que ya dijo cuánto entra. Es lo que decide si adoptar el empaque por defecto arranca la
   * línea en un empaque: sin esto, escanear un tornillo en una compra cuyo default es «Bulto x 1000»
   * mostraba «0,001 bultos», que es la cantidad correcta dicha de la forma más inútil posible.
   */
  it('el código del producto suelto no trae cantidad propia', () => {
    expect(readCarriesQuantity(lookup({ factor: 1 }))).toBe(false);
    expect(readCarriesQuantity(lookup({}))).toBe(false);
  });

  it('el código de un empaque sí: el factor es la cantidad', () => {
    expect(readCarriesQuantity(lookup({ factor: 12, packaging: BOX }))).toBe(true);
  });

  it('la etiqueta de balanza sí: el peso es la cantidad', () => {
    const reading = lookup({
      factor: 1,
      scale: {
        prefix: '2',
        scaleCode: '00123',
        rawValue: '01250',
        checkDigit: '7',
        valueType: 'WEIGHT',
        quantity: 1.25,
        amount: null,
      },
    });

    expect(readCarriesQuantity(reading)).toBe(true);
  });

  /** La que embebe importe no dice el peso, así que la cantidad sigue siendo el 1 neutro. */
  it('la etiqueta que trae importe no trae cantidad', () => {
    const reading = lookup({
      factor: 1,
      scale: {
        prefix: '2',
        scaleCode: '00123',
        rawValue: '01250',
        checkDigit: '7',
        valueType: 'AMOUNT',
        quantity: null,
        amount: 12.5,
      },
    });

    expect(readCarriesQuantity(reading)).toBe(false);
  });
});

describe('packageQuantityOf', () => {
  it('dice cuántos empaques son las unidades de la línea', () => {
    expect(packageQuantityOf(24, BOX)).toBe(2);
    expect(packageQuantityOf(18, BOX)).toBe(1.5);
  });

  /** Sin empaque no hay equivalencia que mostrar: el número de la fila ya está en unidad base. */
  it('no devuelve equivalencia sin empaque o con un factor inservible', () => {
    expect(packageQuantityOf(24, null)).toBeNull();
    expect(packageQuantityOf(24, { name: 'Rota', factor: 0 })).toBeNull();
  });
});

describe('baseQuantityOf', () => {
  it('convierte los empaques a la unidad base, que es lo único que se persiste (RN-16)', () => {
    expect(baseQuantityOf(2, BOX)).toBe(24);
  });

  it('deja la cantidad como está sin empaque', () => {
    expect(baseQuantityOf(3, null)).toBe(3);
    expect(baseQuantityOf(3, { name: 'Rota', factor: 0 })).toBe(3);
  });

  /** Ida y vuelta: lo que la fila muestra vuelve a ser lo que el carrito guarda. */
  it('es el inverso de packageQuantityOf', () => {
    expect(baseQuantityOf(packageQuantityOf(24, BOX) ?? 0, BOX)).toBe(24);
  });
});

describe('defaultPackagingOf', () => {
  const packagings = [
    { uuid: 'p1', name: 'Caja x 12', factor: 12, isSaleDefault: true },
    { uuid: 'p2', name: 'Bulto x 100', factor: 100, isPurchaseDefault: true },
  ];

  /** Comprar por bulto y vender por unidad es el caso que los dos flags resuelven por separado. */
  it('elige el default de cada operación por su lado', () => {
    expect(defaultPackagingOf(packagings, 'purchase')?.name).toBe('Bulto x 100');
    expect(defaultPackagingOf(packagings, 'sale')?.name).toBe('Caja x 12');
  });

  it('no elige nada cuando el producto no declara un default para esa operación', () => {
    expect(defaultPackagingOf([{ uuid: 'p1', name: 'Caja', factor: 6 }], 'sale')).toBeNull();
    expect(defaultPackagingOf(null, 'purchase')).toBeNull();
    expect(defaultPackagingOf(undefined, 'sale')).toBeNull();
  });

  it('devuelve sólo lo que la línea necesita del empaque', () => {
    expect(defaultPackagingOf(packagings, 'purchase')).toEqual({
      uuid: 'p2',
      name: 'Bulto x 100',
      factor: 100,
    });
  });
});
