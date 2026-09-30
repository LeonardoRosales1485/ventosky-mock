import { describe, expect, it } from 'vitest';
import { PickerProduct } from '../../../core/product-picker/product-picker.model';
import { WarehouseDto } from '../../../core/warehouse/warehouse.model';
import { TransferDraft } from './transfer-draft';

function product(uuid: string, stockTracking = 'QUANTITY'): PickerProduct {
  return { uuid, name: `Producto ${uuid}`, stockTracking, unitDecimalPlaces: 0 };
}

function warehouse(uuid: string): WarehouseDto {
  return { uuid, name: `Depósito ${uuid}` } as WarehouseDto;
}

/**
 * En una línea `SERIAL` la cantidad **es un derivado** de las unidades elegidas (RN-17). Es la
 * inversión que ordena toda la feature: en el resto del catálogo se elige una cantidad y después de
 * dónde sale; acá se eligen unidades y la cantidad es cuántas son.
 */
describe('TransferDraft con productos serializados', () => {
  it('arranca la línea en cero: todavía no se eligió ninguna unidad', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('serial-1', 'SERIAL'));

    expect(draft.lines()[0].quantity).toBe(0);
    expect(draft.lineViews()[0].serialTracked).toBe(true);
    expect(draft.lineViews()[0].missingSerials).toBe(true);
  });

  it('la cantidad la fijan las unidades elegidas', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('serial-1', 'SERIAL'));

    draft.setSerials('serial-1', ['SN-1', 'SN-2', 'SN-3']);

    expect(draft.lines()[0].quantity).toBe(3);
    expect(draft.lineViews()[0].missingSerials).toBe(false);
  });

  /** Dejarla escribir desincronizaría la cantidad de `serials` y el commit la rechazaría. */
  it('ignora un cambio de cantidad escrito a mano', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('serial-1', 'SERIAL'));
    draft.setSerials('serial-1', ['SN-1', 'SN-2']);

    draft.setQuantity('serial-1', 7);

    expect(draft.lines()[0].quantity).toBe(2);
    expect(draft.lines()[0].serials).toEqual(['SN-1', 'SN-2']);
  });

  it('no despacha mientras una línea no diga qué unidades se van', () => {
    const draft = new TransferDraft();
    draft.setSourceWarehouse(warehouse('origen'));
    draft.setTargetWarehouse(warehouse('destino'));
    draft.addProduct(product('serial-1', 'SERIAL'));

    expect(draft.linesWithoutSerials()).toHaveLength(1);
    expect(draft.isReadyToDispatch()).toBe(false);

    draft.setSerials('serial-1', ['SN-1']);

    expect(draft.isReadyToDispatch()).toBe(true);
  });

  /** Una unidad del depósito viejo no está en el nuevo: mandarla es `SERIAL_NOT_AVAILABLE`. */
  it('cambiar el depósito de origen descarta las unidades elegidas', () => {
    const draft = new TransferDraft();
    draft.setSourceWarehouse(warehouse('origen'));
    draft.addProduct(product('serial-1', 'SERIAL'));
    draft.setSerials('serial-1', ['SN-1', 'SN-2']);

    draft.setSourceWarehouse(warehouse('otro'));

    expect(draft.lines()[0].serials).toEqual([]);
    expect(draft.lineViews()[0].missingSerials).toBe(true);
  });

  /** Con series el backend ignora `allocations`: mandar las dos sería declarar dos veces el lote. */
  it('manda las series y no el reparto por lote', () => {
    const draft = new TransferDraft();
    draft.setSourceWarehouse(warehouse('origen'));
    draft.addProduct(product('serial-1', 'SERIAL'));
    draft.setSerials('serial-1', ['SN-1', 'SN-2']);

    const [item] = draft.toItems();

    expect(item).toEqual({
      product: { uuid: 'serial-1' },
      quantity: 2,
      serials: ['SN-1', 'SN-2'],
    });
    expect(item.allocations).toBeUndefined();
  });

  /** El resto del catálogo no cambia: la cantidad se sigue escribiendo. */
  it('deja escribir la cantidad en un producto sin series', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('simple-1'));

    draft.setQuantity('simple-1', 5);

    expect(draft.lines()[0].quantity).toBe(5);
    expect(draft.lineViews()[0].serialTracked).toBe(false);
    expect(draft.lineViews()[0].missingSerials).toBe(false);
    expect(draft.toItems()[0]).toEqual({ product: { uuid: 'simple-1' }, quantity: 5 });
  });
});

/**
 * El empaque es **una conversión de pantalla** (RN-16): el stock se lleva siempre en la unidad base
 * y el payload no se entera de que existe. Lo que evita es que mover diez cajas de doce se cargue
 * escribiendo 120 a mano.
 */
describe('TransferDraft con empaques', () => {
  const CAJA = { uuid: 'pack-12', name: 'Caja x 12', factor: 12, isPurchaseDefault: true };
  const BULTO = { uuid: 'pack-100', name: 'Bulto x 100', factor: 100 };

  it('adopta el empaque por defecto de compra, que es como llega la reposición', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('simple-1'));

    draft.setPackagings('simple-1', [BULTO, CAJA]);

    expect(draft.lines()[0].packaging).toEqual({ uuid: 'pack-12', name: 'Caja x 12', factor: 12 });
  });

  it('convierte a unidad base lo que se escribe en cajas', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('simple-1'));
    draft.setPackagings('simple-1', [CAJA]);

    draft.setPackageQuantity('simple-1', 2);

    expect(draft.lines()[0].quantity).toBe(24);
    expect(draft.lineViews()[0].packageQuantity).toBe(2);
    // Lo que viaja es la unidad base: el backend no sabe que existen los empaques.
    expect(draft.toItems()[0]).toEqual({ product: { uuid: 'simple-1' }, quantity: 24 });
  });

  /**
   * Cambiar de anteojos no cambia la mercadería: el que ya cargó 24 unidades y después elige
   * «Caja x 12» quiere ver «2 cajas», no que se le multipliquen las unidades por doce.
   */
  it('cambiar de empaque conserva la cantidad en unidad base', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('simple-1'));
    draft.setPackagings('simple-1', [CAJA]);
    draft.setPackageQuantity('simple-1', 2);

    draft.setPackaging('simple-1', null);

    expect(draft.lines()[0].quantity).toBe(24);
    expect(draft.lineViews()[0].packageQuantity).toBeNull();
  });

  /** Una caja de doce series no es una cantidad: son doce elecciones (RN-17). */
  it('no adopta empaque en una línea con series', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('serial-1', 'SERIAL'));

    draft.setPackagings('serial-1', [CAJA]);

    expect(draft.lines()[0].packaging).toBeNull();
    expect(draft.lines()[0].packagings).toHaveLength(1);
  });

  /** Un producto sin empaques declarados no muestra selector y sigue cargando en unidad base. */
  it('sin empaques declarados no elige ninguno', () => {
    const draft = new TransferDraft();
    draft.addProduct(product('simple-1'));

    draft.setPackagings('simple-1', []);

    expect(draft.lines()[0].packaging).toBeNull();
    expect(draft.lineViews()[0].packageQuantity).toBeNull();
  });
});
