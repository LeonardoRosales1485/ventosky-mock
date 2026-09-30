import { beforeEach, describe, expect, it } from 'vitest';
import {
  PurchasePackagingOption,
  PurchasePaymentMethodDto,
  PurchaseProductDto,
  PurchaseSupplierDto,
  PurchaseVoucherDto,
} from '../data-access/purchase.model';
import { PurchaseCart } from './purchase-cart';

const SUPPLIER: PurchaseSupplierDto = {
  uuid: 'sup-1',
  name: 'Distribuidora Norte',
  docType: 'CUIT',
  docNumber: '30-1-9',
};

/** Factura A: discrimina el IVA y lo suma al costo. */
const INVOICE_A: PurchaseVoucherDto = {
  uuid: 'v-a',
  name: 'Factura A',
  code: 'PURCHASE_INVOICE_A',
  operationType: 'PURCHASE',
  stockEffect: 'INCREMENT',
  balanceEffect: 'DECREMENT',
  addsTax: true,
};

/** Factura B: el costo se toma tal cual, sin agregarle impuesto. */
const INVOICE_B: PurchaseVoucherDto = {
  ...INVOICE_A,
  uuid: 'v-b',
  name: 'Factura B',
  code: 'PURCHASE_INVOICE_B',
  addsTax: false,
};

/** Orden de compra: no mueve stock ni cuenta corriente, así que no se paga. */
const PURCHASE_ORDER: PurchaseVoucherDto = {
  uuid: 'v-order',
  name: 'Orden de compra',
  code: 'PURCHASE_ORDER',
  operationType: 'PURCHASE',
  stockEffect: 'NONE',
  balanceEffect: 'NONE',
  addsTax: true,
};

const CASH: PurchasePaymentMethodDto = { uuid: 'pm-cash', name: 'Efectivo', code: 'CASH' };

/** Se compra de a unidades enteras. */
const SNEAKERS: PurchaseProductDto = {
  uuid: 'p-1',
  name: 'Zapatillas',
  taxRate: 21,
  unitDecimalPlaces: 0,
  isForPurchase: true,
};

const SOCKS: PurchaseProductDto = {
  uuid: 'p-2',
  name: 'Medias',
  taxRate: 21,
  unitDecimalPlaces: 0,
  isForPurchase: true,
};

/** Se compra por kilo: admite hasta tres decimales. */
const COFFEE: PurchaseProductDto = {
  uuid: 'p-3',
  name: 'Café en grano',
  taxRate: 21,
  unitMeasure: 'KILOGRAM',
  unitDecimalPlaces: 3,
  isForPurchase: true,
};

/** Sin alícuota propia: el backend cae a 21. */
const UNTAXED: PurchaseProductDto = { uuid: 'p-4', name: 'Insumo', unitDecimalPlaces: 0 };

/** El bulto con el que se compran las medias, declarado como empaque por defecto de compra. */
const PACK_OF_TWELVE: PurchasePackagingOption = {
  uuid: 'pk-12',
  name: 'Pack x 12',
  factor: 12,
  isPurchaseDefault: true,
};

describe('PurchaseCart', () => {
  let cart: PurchaseCart;

  beforeEach(() => {
    cart = new PurchaseCart();
    cart.setSupplier(SUPPLIER);
    cart.setVoucher(INVOICE_A);
  });

  describe('líneas', () => {
    it('agrega el producto con el costo propuesto', () => {
      cart.addProduct(SNEAKERS, 2, 1000);

      expect(cart.lines()).toHaveLength(1);
      expect(cart.lines()[0]).toMatchObject({ quantity: 2, unitCost: 1000, taxRate: 21 });
    });

    it('suma la cantidad al volver a leer el mismo producto, sin pisar el costo cargado', () => {
      cart.addProduct(SNEAKERS, 1, 1000);
      cart.setUnitCost(SNEAKERS.uuid, 1234);
      cart.addProduct(SNEAKERS, 1, 9999);

      expect(cart.lines()).toHaveLength(1);
      expect(cart.lines()[0].quantity).toBe(2);
      expect(cart.lines()[0].unitCost).toBe(1234);
    });

    it('cae a la alícuota por defecto cuando el producto no declara la suya', () => {
      cart.addProduct(UNTAXED, 1, 100);

      expect(cart.lines()[0].taxRate).toBe(21);
    });

    it('recorta la cantidad a los decimales que admite la unidad', () => {
      cart.addProduct(SNEAKERS, 2.7, 1000);
      cart.addProduct(COFFEE, 1.23456, 5000);

      expect(cart.lines()[0].quantity).toBe(3);
      expect(cart.lines()[1].quantity).toBe(1.235);
    });

    /**
     * El bulto por defecto llega **después** de la línea, con el detalle del producto. La línea que
     * sigue en el 1 neutro del buscador lo adopta; la que vino con cantidad fijada —una celda de la
     * grilla por modelo— no: seis remeras son seis remeras.
     */
    it('adopta el bulto por defecto cuando la línea sigue en el 1 neutro del buscador', () => {
      cart.addProduct(SOCKS);
      cart.setProductPackagings(SOCKS.uuid, [PACK_OF_TWELVE]);

      expect(cart.lines()[0].packaging?.uuid).toBe(PACK_OF_TWELVE.uuid);
      expect(cart.lines()[0].quantity).toBe(12);
    });

    it('no reinterpreta como un bulto la cantidad explícita de una línea al llegar sus empaques', () => {
      cart.addProduct(SOCKS, 1, null, null, true);
      cart.setProductPackagings(SOCKS.uuid, [PACK_OF_TWELVE]);

      expect(cart.lines()[0].packaging).toBeNull();
      expect(cart.lines()[0].quantity).toBe(1);
      // El selector sí se estrena: los empaques quedan en el producto de la línea.
      expect(cart.lines()[0].product.packagings).toEqual([PACK_OF_TWELVE]);
    });

    it('quita la línea pedida y deja el resto', () => {
      cart.addProduct(SNEAKERS, 1, 1000);
      cart.addProduct(SOCKS, 1, 500);
      cart.removeLine(SNEAKERS.uuid);

      expect(cart.lines()).toHaveLength(1);
      expect(cart.lines()[0].product.uuid).toBe(SOCKS.uuid);
    });
  });

  describe('costo', () => {
    it('acepta el cero: es un costo válido, no un dato que falta', () => {
      cart.addProduct(SNEAKERS, 1, null);
      cart.setUnitCost(SNEAKERS.uuid, 0);

      expect(cart.lines()[0].unitCost).toBe(0);
      expect(cart.linesWithoutCost()).toHaveLength(0);
    });

    it('guarda un negativo como "sin cargar": el backend lo rechazaría', () => {
      cart.addProduct(SNEAKERS, 1, 1000);
      cart.setUnitCost(SNEAKERS.uuid, -5);

      expect(cart.lines()[0].unitCost).toBeNull();
      expect(cart.linesWithoutCost()).toHaveLength(1);
    });

    it('propone un costo sólo mientras la línea no tenga uno', () => {
      cart.addProduct(SNEAKERS, 1, null);
      cart.suggestUnitCost(SNEAKERS.uuid, 800);
      cart.suggestUnitCost(SNEAKERS.uuid, 999);

      expect(cart.lines()[0].unitCost).toBe(800);
    });

    it('no pisa con la propuesta lo que el operador escribió', () => {
      cart.addProduct(SNEAKERS, 1, null);
      cart.setUnitCost(SNEAKERS.uuid, 1500);
      cart.suggestUnitCost(SNEAKERS.uuid, 800);

      expect(cart.lines()[0].unitCost).toBe(1500);
    });
  });

  describe('importes', () => {
    it('suma el impuesto sobre el costo con un comprobante que lo discrimina', () => {
      cart.addProduct(SNEAKERS, 2, 1000);

      expect(cart.totals()).toMatchObject({ netAmount: 2000, taxAmount: 420, totalAmount: 2420 });
    });

    it('deja el impuesto en cero con un comprobante que no lo suma', () => {
      cart.setVoucher(INVOICE_B);
      cart.addProduct(SNEAKERS, 2, 1000);

      expect(cart.totals()).toMatchObject({ netAmount: 2000, taxAmount: 0, totalAmount: 2000 });
    });

    it('ignora en los totales las líneas que todavía no tienen costo', () => {
      cart.addProduct(SNEAKERS, 1, 1000);
      cart.addProduct(SOCKS, 1, null);

      expect(cart.totals().netAmount).toBe(1000);
      expect(cart.linesWithoutCost()).toHaveLength(1);
    });
  });

  describe('pagos', () => {
    beforeEach(() => {
      cart.addProduct(SNEAKERS, 2, 1000);
    });

    it('descuenta lo pagado del total pendiente', () => {
      cart.addPayment(CASH, 400);

      expect(cart.paidAmount()).toBe(400);
      expect(cart.remainingAmount()).toBe(2020);
      expect(cart.isFullyPaid()).toBe(false);
    });

    it('queda saldada cuando los pagos cubren el total', () => {
      cart.addPayment(CASH, 2420);

      expect(cart.isFullyPaid()).toBe(true);
      expect(cart.changeAmount()).toBe(0);
    });

    it('informa el excedente cuando el reparto se pasa del total', () => {
      cart.addPayment(CASH, 2500);

      expect(cart.changeAmount()).toBe(80);
    });

    it('quita el pago por posición', () => {
      cart.addPayment(CASH, 1000);
      cart.addPayment(CASH, 1420);
      cart.removePayment(0);

      expect(cart.payments()).toHaveLength(1);
      expect(cart.paidAmount()).toBe(1420);
    });
  });

  describe('isReadyToCommit', () => {
    const ready = () => {
      const fresh = new PurchaseCart();
      fresh.setSupplier(SUPPLIER);
      fresh.setVoucher(INVOICE_A);
      fresh.addProduct(SNEAKERS, 2, 1000);
      fresh.addPayment(CASH, 2420);
      return fresh;
    };

    it('está lista con proveedor, comprobante, líneas con costo y el total pagado', () => {
      expect(ready().isReadyToCommit()).toBe(true);
    });

    it('no está lista con el carrito vacío', () => {
      const empty = ready();
      empty.clearCart();

      expect(empty.isReadyToCommit()).toBe(false);
    });

    it('no está lista sin proveedor', () => {
      const cartWithoutSupplier = ready();
      cartWithoutSupplier.setSupplier(null);

      expect(cartWithoutSupplier.isReadyToCommit()).toBe(false);
    });

    it('no está lista sin comprobante', () => {
      const cartWithoutVoucher = ready();
      cartWithoutVoucher.setVoucher(null);

      expect(cartWithoutVoucher.isReadyToCommit()).toBe(false);
    });

    it('no está lista con una línea sin costo', () => {
      const cartWithoutCost = ready();
      cartWithoutCost.addProduct(SOCKS, 1, null);

      expect(cartWithoutCost.isReadyToCommit()).toBe(false);
    });

    it('no está lista mientras los pagos no cubran el total', () => {
      const underpaid = ready();
      underpaid.removePayment(0);
      underpaid.addPayment(CASH, 1000);

      expect(underpaid.isReadyToCommit()).toBe(false);
    });
  });

  describe('comprobante sin efecto contable', () => {
    it('no exige pago: la orden de compra no es un egreso todavía', () => {
      cart.setVoucher(PURCHASE_ORDER);
      cart.addProduct(SNEAKERS, 2, 1000);

      expect(cart.requiresPayment()).toBe(false);
      expect(cart.isFullyPaid()).toBe(true);
      expect(cart.isReadyToCommit()).toBe(true);
    });

    it('se lleva los pagos ya cargados al elegirlo: mandarlos sería un 400 del commit', () => {
      cart.addProduct(SNEAKERS, 2, 1000);
      cart.addPayment(CASH, 2420);

      cart.setVoucher(PURCHASE_ORDER);

      expect(cart.payments()).toHaveLength(0);
    });

    it('vuelve a exigir pago al elegir un comprobante que sí mueve la cuenta', () => {
      cart.setVoucher(PURCHASE_ORDER);
      cart.addProduct(SNEAKERS, 2, 1000);
      cart.setVoucher(INVOICE_A);

      expect(cart.requiresPayment()).toBe(true);
      expect(cart.isReadyToCommit()).toBe(false);
    });
  });

  describe('nota', () => {
    it('arranca vacía y guarda lo que se escribe', () => {
      expect(cart.observations()).toBe('');

      cart.setObservations('Faltaron 2 bultos.');

      expect(cart.observations()).toBe('Faltaron 2 bultos.');
    });
  });

  describe('clearCart', () => {
    it('vacía líneas, pagos y nota, pero conserva proveedor, comprobante y fecha', () => {
      const date = new Date('2026-08-10T09:30:00');
      cart.setDateOperation(date);
      cart.addProduct(SNEAKERS, 1, 1000);
      cart.addPayment(CASH, 1210);
      cart.setObservations('Remito 0001-45678');

      cart.clearCart();

      expect(cart.isEmpty()).toBe(true);
      expect(cart.payments()).toHaveLength(0);
      expect(cart.observations()).toBe('');
      expect(cart.supplier()).toBe(SUPPLIER);
      expect(cart.voucher()).toBe(INVOICE_A);
      expect(cart.dateOperation()).toBe(date);
    });
  });
});
