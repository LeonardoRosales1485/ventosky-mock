import { describe, expect, it } from 'vitest';
import { ProductChipId } from '../../../shared/components/product-chip/product-chip';
import { productChipsOf } from './product-chips';
import { ProductPaginateDto } from './product.model';

function product(fields: Partial<ProductPaginateDto>): ProductPaginateDto {
  return { uuid: 'p-1', name: 'Producto', ...fields } as ProductPaginateDto;
}

function ids(fields: Partial<ProductPaginateDto>): ProductChipId[] {
  return productChipsOf(product(fields)).map((chip) => chip.id);
}

describe('productChipsOf', () => {
  it('no marca nada en el producto de siempre', () => {
    expect(ids({ type: 'SIMPLE', stockTracking: 'QUANTITY', expirationControl: 'NONE' })).toEqual(
      [],
    );
  });

  it('trata los ejes ausentes como el default, no como un eje distinto', () => {
    // Es lo que hace que un catálogo cargado antes de los ejes (RN-21) se siga viendo igual.
    expect(ids({})).toEqual([]);
  });

  it('marca el lote y el vencimiento por separado', () => {
    expect(ids({ stockTracking: 'BATCH', expirationControl: 'REQUIRED' })).toEqual([
      'batch',
      'expires',
    ]);
  });

  it('marca «vence» tanto si el vencimiento es obligatorio como si es opcional', () => {
    expect(ids({ expirationControl: 'OPTIONAL' })).toEqual(['expires']);
  });

  it('marca la serie', () => {
    expect(ids({ stockTracking: 'SERIAL' })).toEqual(['serial']);
  });

  it('pone primero qué es el producto y después cómo se controla', () => {
    expect(ids({ type: 'KIT', stockTracking: 'BATCH', expirationControl: 'OPTIONAL' })).toEqual([
      'kit',
      'batch',
      'expires',
    ]);
  });

  it('distingue el servicio del kit', () => {
    expect(ids({ type: 'SERVICE', stockTracking: 'NONE' })).toEqual(['service']);
    expect(ids({ type: 'KIT', stockTracking: 'NONE' })).toEqual(['kit']);
  });

  it('el kit dice cuántos componentes tiene cuando el paginado los cuenta', () => {
    const [chip] = productChipsOf(product({ type: 'KIT', kitItemsCount: 3 }));
    expect(chip.labelKey).toBe('products.chips.kitWithCount');
    expect(chip.params).toEqual({ count: 3 });
  });

  it('un kit sin conteo se marca igual, sólo que sin el número', () => {
    // El paginado puede no traerlo; el chip no puede desaparecer por eso.
    const [chip] = productChipsOf(product({ type: 'KIT' }));
    expect(chip.labelKey).toBe('products.chips.kit');
    expect(chip.params).toBeUndefined();
  });

  it('distingue el kit armado del virtual, que es lo que le da sentido a la columna Stock', () => {
    // La fila del armado dice un saldo propio: llamarla «kit virtual» contradice lo que muestra al
    // lado. Los ejes los conserva enteros, así que además acumula chips que el virtual no puede.
    expect(
      ids({
        type: 'KIT',
        kitMode: 'ASSEMBLE',
        stockTracking: 'BATCH',
        expirationControl: 'REQUIRED',
      }),
    ).toEqual(['kitAssembled', 'batch', 'expires']);
  });

  it('el kit armado también cuenta sus componentes', () => {
    const [chip] = productChipsOf(product({ type: 'KIT', kitMode: 'ASSEMBLE', kitItemsCount: 6 }));
    expect(chip.labelKey).toBe('products.chips.kitAssembledWithCount');
    expect(chip.params).toEqual({ count: 6 });
  });

  it('un kit anterior a la Entrega G se sigue leyendo virtual', () => {
    // El backend guarda `kit_mode` en null en todo kit cargado antes del armado (RN-21).
    expect(ids({ type: 'KIT', kitMode: null })).toEqual(['kit']);
    expect(ids({ type: 'KIT', kitMode: 'ALGO_NUEVO' })).toEqual(['kit']);
  });

  it('marca el pesable, y lo lee después de qué es el producto', () => {
    expect(ids({ isWeighable: true })).toEqual(['weighable']);
    expect(ids({ type: 'KIT', isWeighable: true })).toEqual(['kit', 'weighable']);
  });

  it('no marca pesable al producto que no lo es', () => {
    expect(ids({ isWeighable: false })).toEqual([]);
  });

  it('cae al default ante un eje desconocido en vez de inventar un chip', () => {
    expect(ids({ type: 'ALGO_NUEVO', stockTracking: 'OTRA_COSA' })).toEqual([]);
  });
});

describe('productChipsOf · discontinuado', () => {
  it('marca el producto que no se compra ni se vende', () => {
    // Las dos banderas apagadas, que es la definición del ADR 0001 y la que usa
    // `ProductCatalogState.of` del backend.
    expect(ids({ isForSale: false, isForPurchase: false })).toEqual(['discontinued']);
  });

  it('no marca al que se dejó de comprar pero se sigue vendiendo', () => {
    // Es un activo en liquidación, no un producto retirado: marcarlo mandaría a revisar el catálogo
    // a quien no tiene nada que revisar.
    expect(ids({ isForSale: true, isForPurchase: false })).toEqual([]);
  });

  it('no marca al que se compra pero no se vende', () => {
    // El insumo o el componente de kit: tampoco salió del catálogo.
    expect(ids({ isForSale: false, isForPurchase: true })).toEqual([]);
  });

  it('no marca al producto cuyas banderas el paginado no informa', () => {
    // Ausente no es `false`: un paginado viejo no convierte el catálogo entero en discontinuado.
    expect(ids({ isForSale: null, isForPurchase: null })).toEqual([]);
    expect(ids({})).toEqual([]);
  });

  it('va primero: es lo que cambia cómo se lee el resto de la fila', () => {
    expect(ids({ isForSale: false, isForPurchase: false, type: 'KIT', stockTracking: 'BATCH' })).toEqual([
      'discontinued',
      'kit',
      'batch',
    ]);
  });
});
