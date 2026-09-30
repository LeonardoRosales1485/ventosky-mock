import { beforeEach, describe, expect, it } from 'vitest';
import {
  SaleCustomerDto,
  SalePaymentMethodDto,
  SaleProductDto,
  SalePromotionDto,
} from '../data-access/sale.model';
import { DirectSaleCart } from './direct-sale-cart';

const PRINCIPAL = 'principal-uuid';
const WHOLESALE = 'wholesale-uuid';

const CASH: SalePaymentMethodDto = { uuid: 'cash-uuid', name: 'Efectivo', code: 'CASH' };
const CARD: SalePaymentMethodDto = { uuid: 'card-uuid', name: 'Tarjeta', code: 'CARD' };

/** La sucursal en la que se está atendiendo: contra ella se filtran las promociones por sucursal. */
const BRANCH = 'branch-uuid';

/**
 * Dos categorías de una misma rama: `Running` cuelga de `Calzado`. Es lo que hace falta para probar
 * que una promoción cargada sobre la categoría padre alcanza al producto de la hija.
 */
const FOOTWEAR = 'footwear-uuid';
const RUNNING = 'running-uuid';
const DRINKS = 'drinks-uuid';

/** El linaje de cada categoría, como lo deja `toCategoryChains` sobre el árbol de la empresa. */
const CATEGORY_CHAINS: ReadonlyMap<string, readonly string[]> = new Map([
  [FOOTWEAR, [FOOTWEAR]],
  [RUNNING, [RUNNING, FOOTWEAR]],
  [DRINKS, [DRINKS]],
]);

const SNEAKERS: SaleProductDto = {
  uuid: 'sneakers-uuid',
  name: 'Zapatillas Running Pro X',
  sku: 'ZAP-RX-42',
  category: { uuid: RUNNING, name: 'Running' },
  taxRate: 21,
  totalStock: 3,
  priceListEntries: [
    { priceListUuid: PRINCIPAL, price: 45000 },
    { priceListUuid: WHOLESALE, price: 38000 },
  ],
};

const SOCKS: SaleProductDto = {
  uuid: 'socks-uuid',
  name: 'Medias Deportivas (Pack 3)',
  sku: 'MED-DEP-3',
  category: { uuid: FOOTWEAR, name: 'Calzado' },
  taxRate: 21,
  totalStock: 10,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 5000 }],
};

/**
 * Producto que se vende por peso: `unitDecimalPlaces: 3` es lo que declara `KILOGRAM`. Es el caso que
 * el carrito no podía atender mientras truncaba toda cantidad a entero.
 */
const COFFEE: SaleProductDto = {
  uuid: 'coffee-uuid',
  name: 'Café en grano',
  sku: 'CAF-GR',
  unitMeasure: 'KILOGRAM',
  unitDecimalPlaces: 3,
  taxRate: 21,
  totalStock: 8,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 20000 }],
};

/** El mismo mostrador con una unidad discreta declarada: `UNIT` no se fracciona. */
const MUG: SaleProductDto = {
  uuid: 'mug-uuid',
  name: 'Taza',
  sku: 'TAZ-01',
  unitMeasure: 'UNIT',
  unitDecimalPlaces: 0,
  taxRate: 21,
  totalStock: 20,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 8000 }],
};

/** El precio está cargado y dice cero: existe la entrada, pero con eso no se puede cobrar. */
const GIFT_BAG: SaleProductDto = {
  uuid: 'gift-bag-uuid',
  name: 'Bolsa de regalo',
  sku: 'BOL-REG',
  taxRate: 21,
  totalStock: 50,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 0 }],
};

/**
 * Un combo. No lleva stock —`stockTracking: 'NONE'`, que es lo que `type: 'KIT'` fuerza— así que su
 * `totalStock` viene en `null`: el disponible sale de los componentes (RN-07).
 */
const BREAKFAST_KIT: SaleProductDto = {
  uuid: 'kit-uuid',
  name: 'Combo Desayuno',
  sku: 'COMBO-01',
  type: 'KIT',
  stockTracking: 'NONE',
  taxRate: 21,
  totalStock: null,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 3500 }],
};

/**
 * Un kit **armado**: es un producto. Conserva el eje de existencias y tiene saldo propio (RN-22),
 * así que en el carrito se comporta como cualquier mercadería: su línea no se explota, el faltante
 * se mide contra su `totalStock` y nadie le pregunta la composición.
 */
const ASSEMBLED_PC: SaleProductDto = {
  uuid: 'assembled-pc-uuid',
  name: 'PC Armada 1',
  sku: 'P-54545',
  type: 'KIT',
  kitMode: 'ASSEMBLE',
  stockTracking: 'QUANTITY',
  taxRate: 21,
  totalStock: 3,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 900000 }],
};

/** Un servicio: tampoco lleva stock, y por lo tanto tampoco puede tener faltante. */
const ASSEMBLY_SERVICE: SaleProductDto = {
  uuid: 'service-uuid',
  name: 'Servicio de armado',
  sku: 'SERV-01',
  type: 'SERVICE',
  stockTracking: 'NONE',
  taxRate: 21,
  totalStock: null,
  priceListEntries: [{ priceListUuid: PRINCIPAL, price: 4000 }],
};

const WHOLESALE_CUSTOMER: SaleCustomerDto = {
  uuid: 'customer-uuid',
  name: 'Distribuidora Sur',
  priceList: { uuid: WHOLESALE, name: 'Mayorista' },
};

/* ────────────────────────────  Promociones  ──────────────────────────── */

/**
 * Dos categorías de una misma rama: `Running` cuelga de `Calzado`. Es lo que hace falta para probar
 * que una promoción cargada sobre la categoría padre alcanza al producto de la hija.
 */

/** Una promoción cualquiera ya vigente: las fechas no son lo que cada caso está probando. */
function promotion(promotion: Partial<SalePromotionDto> & { uuid: string }): SalePromotionDto {
  return {
    name: 'Promoción',
    type: 'PERCENTAGE',
    scope: 'PRODUCTS',
    validFrom: '2020-01-01',
    ...promotion,
  };
}

const ref = (product: SaleProductDto) => ({ uuid: product.uuid, name: product.name });

describe('DirectSaleCart', () => {
  let cart: DirectSaleCart;

  beforeEach(() => {
    cart = new DirectSaleCart();
    // El consumidor final no tiene lista asignada: su precio sale de la principal, que es la lista
    // que el backend elige cuando la venta no trae cliente.
    cart.setPriceLists([
      { uuid: PRINCIPAL, name: 'Principal', isPrincipal: true },
      { uuid: WHOLESALE, name: 'Mayorista' },
    ]);
    cart.setVoucher({
      uuid: 'voucher-uuid',
      name: 'Factura A (venta)',
      operationType: 'SALE',
      stockEffect: 'DECREMENT',
      balanceEffect: 'INCREMENT',
      addsTax: true,
    });
    cart.setCustomer({ uuid: 'cliente-uuid', name: 'Cliente Mostrador' });
  });

  it('totals the cart of the mockup', () => {
    cart.addProduct(SNEAKERS);
    cart.addProduct(SOCKS, 2);

    expect(cart.totals()).toMatchObject({
      netAmount: 55000,
      taxAmount: 11550,
      totalAmount: 66550,
    });
  });

  /** Escanear dos veces el mismo producto es pedir dos unidades, no abrir dos renglones. */
  it('adds up quantity instead of opening a second line for the same product', () => {
    cart.addProduct(SNEAKERS);
    cart.addProduct(SNEAKERS);

    expect(cart.lines()).toHaveLength(1);
    expect(cart.lines()[0].quantity).toBe(2);
  });

  it('never lets a line drop below one unit', () => {
    cart.addProduct(SNEAKERS);
    cart.setQuantity(SNEAKERS.uuid, 0);

    expect(cart.lines()[0].quantity).toBe(1);
  });

  /**
   * La cantidad se mide con la precisión que declara la unidad del producto. Antes el carrito
   * truncaba **todo** a entero, así que un producto que se vende por kilo no se podía vender por
   * kilo: 0,75 caía a 0 y de ahí al mínimo de 1.
   */
  it('keeps a fractional quantity on a product sold by weight', () => {
    cart.addProduct(COFFEE);
    cart.setQuantity(COFFEE.uuid, 0.75);

    expect(cart.lines()[0].quantity).toBe(0.75);
  });

  it('prices a fractional quantity against the resolved unit price', () => {
    cart.addProduct(COFFEE);
    cart.setQuantity(COFFEE.uuid, 0.5);

    // Medio kilo a 20.000 el kilo: 10.000 netos, más el 21 %.
    expect(cart.totals()).toMatchObject({ netAmount: 10000, taxAmount: 2100, totalAmount: 12100 });
  });

  /** Más allá del gramo la cantidad no existe: se ajusta al decimal más fino que la unidad admite. */
  it('snaps a quantity finer than the unit allows', () => {
    cart.addProduct(COFFEE);
    cart.setQuantity(COFFEE.uuid, 0.7555);

    expect(cart.lines()[0].quantity).toBe(0.756);
  });

  /** La otra mitad de la regla: en una unidad discreta la fracción se redondea a entero. */
  it('rounds a fractional quantity to a whole number on a discrete unit', () => {
    cart.addProduct(MUG);
    cart.setQuantity(MUG.uuid, 1.5);

    expect(cart.lines()[0].quantity).toBe(2);
  });

  it('never lets a product sold by weight drop to zero', () => {
    cart.addProduct(COFFEE);
    cart.setQuantity(COFFEE.uuid, 0);

    expect(cart.lines()[0].quantity).toBe(0.001);
  });

  /** Escanear suma, y en un producto por peso el escaneo sigue sumando de a un kilo. */
  it('adds up fractional quantities of the same product', () => {
    cart.addProduct(COFFEE, 0.25);
    cart.addProduct(COFFEE, 0.5);

    expect(cart.lines()).toHaveLength(1);
    expect(cart.lines()[0].quantity).toBe(0.75);
  });

  /**
   * El precio sale de la lista del cliente. Cambiar de cliente en medio de la venta tiene que
   * arrastrar lo que ya está en el carrito: si no, se cobraría con la lista del cliente anterior.
   */
  it('reprices the whole cart when the customer changes', () => {
    cart.addProduct(SNEAKERS);
    expect(cart.lines()[0].unitPrice).toBe(45000);

    cart.setCustomer(WHOLESALE_CUSTOMER);

    expect(cart.lines()[0].unitPrice).toBe(38000);
    expect(cart.lines()[0].priceListUuid).toBe(WHOLESALE);
  });

  /**
   * Un producto que no está en la lista del cliente no tiene precio: el backend responde 400 en el
   * checkout —desde la `v83` no cae a la principal— y se marca en la línea para que se vea antes de
   * cobrar y no después.
   */
  it('flags the line whose product has no price in the list that applies', () => {
    cart.setCustomer(WHOLESALE_CUSTOMER);
    cart.addProduct(SOCKS);

    expect(cart.unsellableLines()).toHaveLength(1);
    expect(cart.isReadyToCommit()).toBe(false);
  });

  /** Un cero configurado no habilita a regalar la mercadería: frena igual que la falta de precio. */
  it('does not let a line priced at zero be sold', () => {
    cart.addProduct(GIFT_BAG);

    expect(cart.lines()[0].unitPrice).toBe(0);
    expect(cart.unsellableLines()).toHaveLength(1);
    expect(cart.unsellableLines()[0].priceIssue).toBe('ZERO_PRICE');
    expect(cart.isReadyToCommit()).toBe(false);
  });

  describe('price list per line', () => {
    it('reprices only the line whose list the operator changed', () => {
      cart.addProduct(SNEAKERS);
      cart.addProduct(SOCKS);

      cart.setLinesPriceList([SNEAKERS.uuid], WHOLESALE);

      const [sneakers, socks] = cart.lines();
      expect(sneakers.unitPrice).toBe(38000);
      expect(sneakers.chosenPriceListUuid).toBe(WHOLESALE);
      expect(socks.unitPrice).toBe(5000);
      expect(socks.chosenPriceListUuid).toBeNull();
    });

    /**
     * El fallback existe para la lista que resolvió sola, no para la que alguien eligió: caer a la
     * principal cobraría un precio de otra lista sin avisar, y encima taparía que ese producto no
     * está en la que se pidió. Se prefiere frenar la venta y que se vea.
     */
    it('does not fall back to the principal list when the operator picked one', () => {
      cart.addProduct(SOCKS); // sólo tiene precio en la principal

      cart.setLinesPriceList([SOCKS.uuid], WHOLESALE);

      expect(cart.lines()[0].unitPrice).toBeNull();
      expect(cart.unsellableLines()[0].priceIssue).toBe('NO_PRICE');
      expect(cart.isReadyToCommit()).toBe(false);
    });

    it('gives the line back to the cart list', () => {
      cart.addProduct(SNEAKERS);
      cart.setLinesPriceList([SNEAKERS.uuid], WHOLESALE);

      cart.setLinesPriceList([SNEAKERS.uuid], null);

      expect(cart.lines()[0].chosenPriceListUuid).toBeNull();
      expect(cart.lines()[0].unitPrice).toBe(45000);
    });

    /** La acción en lote: se marcan unas cuantas y se les cambia la lista de una. */
    it('changes several lines at once and leaves the rest alone', () => {
      cart.addProduct(SNEAKERS);
      cart.addProduct(SOCKS);
      cart.addProduct(GIFT_BAG);

      cart.setLinesPriceList([SNEAKERS.uuid, GIFT_BAG.uuid], WHOLESALE);

      expect(cart.lines().map((line) => line.chosenPriceListUuid)).toEqual([
        WHOLESALE,
        null,
        WHOLESALE,
      ]);
    });
  });

  it('takes every marked line out of the cart at once', () => {
    cart.addProduct(SNEAKERS);
    cart.addProduct(SOCKS);
    cart.addProduct(GIFT_BAG);

    cart.removeLines([SNEAKERS.uuid, GIFT_BAG.uuid]);

    expect(cart.lines().map((line) => line.product.uuid)).toEqual([SOCKS.uuid]);
  });

  describe('price list for the whole cart', () => {
    it('reprices every line and what gets added afterwards', () => {
      cart.addProduct(SNEAKERS);

      cart.setCartPriceList(WHOLESALE);
      cart.addProduct(SOCKS);

      expect(cart.cartPriceListUuid()).toBe(WHOLESALE);
      expect(cart.lines()[0].unitPrice).toBe(38000);
      // Las medias no están en mayorista y la elección no cae a la principal: quedan sin precio.
      expect(cart.lines()[1].unitPrice).toBeNull();
    });

    /** «Todos los productos» son todos: la línea que tenía lista propia también se suelta. */
    it('releases the lists pinned on single lines', () => {
      cart.addProduct(SNEAKERS);
      cart.setLinesPriceList([SNEAKERS.uuid], WHOLESALE);

      cart.setCartPriceList(PRINCIPAL);

      expect(cart.lines()[0].chosenPriceListUuid).toBeNull();
      expect(cart.lines()[0].unitPrice).toBe(45000);
    });

    it('goes back to the customer list', () => {
      cart.setCustomer(WHOLESALE_CUSTOMER);
      cart.addProduct(SNEAKERS);
      cart.setCartPriceList(PRINCIPAL);

      cart.setCartPriceList(null);

      expect(cart.lines()[0].unitPrice).toBe(38000);
    });

    /**
     * Las listas elegidas eran decisiones tomadas para el cliente anterior: arrastrarlas al nuevo
     * es cobrarle una lista que nadie eligió para él.
     */
    it('is released when the customer changes', () => {
      cart.addProduct(SNEAKERS);
      cart.setLinesPriceList([SNEAKERS.uuid], PRINCIPAL);
      cart.setCartPriceList(PRINCIPAL);

      cart.setCustomer(WHOLESALE_CUSTOMER);

      expect(cart.cartPriceListUuid()).toBeNull();
      expect(cart.lines()[0].chosenPriceListUuid).toBeNull();
      expect(cart.lines()[0].unitPrice).toBe(38000);
    });
  });

  /**
   * `adds_tax = false` (una factura B o C): se cobra el importe de la lista sin discriminar nada.
   * Cambiar de comprobante en medio de la venta tiene que recalcular todo el carrito, no sólo lo que
   * se agregue después.
   */
  it('drops the tax from the whole cart when the voucher does not add it', () => {
    cart.addProduct(SNEAKERS);
    cart.addProduct(SOCKS, 2);

    cart.setVoucher({
      uuid: 'invoice-b-uuid',
      name: 'Factura B (venta)',
      operationType: 'SALE',
      stockEffect: 'DECREMENT',
      balanceEffect: 'INCREMENT',
      addsTax: false,
    });

    expect(cart.addsTax()).toBe(false);
    expect(cart.totals()).toMatchObject({
      netAmount: 55000,
      taxAmount: 0,
      totalAmount: 55000,
    });
  });

  /**
   * El redondeo lo declara la regla de precio de cada producto, así que llega **después** de
   * agregarlo al carrito y sólo para él: la línea se dibuja con el default y se corrige sola.
   */
  it('applies the rounding of each product on its own line', () => {
    cart.addProduct(SNEAKERS);
    cart.addProduct(SOCKS);

    cart.setProductRounding(SNEAKERS.uuid, { mode: 'MULTIPLE_100', direction: 'UP' });

    const [sneakers, socks] = cart.lineViews();
    // El criterio entra en las tres cuentas: el IVA de 9450 sube a 9500 y con él el subtotal.
    expect(sneakers.amounts?.unitPrice).toBe(45000);
    expect(sneakers.amounts?.taxAmount).toBe(9500);
    expect(sneakers.amounts?.subtotal).toBe(54500);
    expect(socks.amounts?.subtotal).toBe(6050); // sin regla propia, sigue en dos decimales
  });

  describe('payments', () => {
    beforeEach(() => {
      cart.addProduct(SNEAKERS);
      cart.addProduct(SOCKS, 2);
    });

    it('splits the charge across several methods', () => {
      cart.addPayment(CARD, 30000);
      expect(cart.remainingAmount()).toBeCloseTo(36550, 2);
      expect(cart.isFullyPaid()).toBe(false);

      cart.addPayment(CASH, 36550);
      expect(cart.isFullyPaid()).toBe(true);
      expect(cart.isReadyToCommit()).toBe(true);
    });

    it('reports the change when the charge goes over the total', () => {
      cart.addPayment(CASH, 70000);

      expect(cart.changeAmount()).toBeCloseTo(3450, 2);
      expect(cart.isReadyToCommit()).toBe(true);
    });

    it('reopens the outstanding balance when a payment is removed', () => {
      cart.addPayment(CASH, 66550);
      cart.removePayment(0);

      expect(cart.remainingAmount()).toBeCloseTo(66550, 2);
      expect(cart.isReadyToCommit()).toBe(false);
    });

    /** El diálogo del cobro arma la lista entera y la deja de una: lo anterior no se acumula. */
    it('takes over the whole charge from the payment dialog', () => {
      cart.addPayment(CARD, 30000);
      cart.setPayments([{ paymentMethod: CASH, amount: 66550 }]);

      expect(cart.payments()).toEqual([{ paymentMethod: CASH, amount: 66550 }]);
      expect(cart.isFullyPaid()).toBe(true);
    });
  });

  describe('stock shortages', () => {
    beforeEach(() => {
      cart.addProduct(SNEAKERS, 5); // hay 3
      cart.addPayment(CASH, 999999);
    });

    it('reports the shortage in the same shape as the backend 409', () => {
      expect(cart.shortages()).toEqual([
        {
          productUuid: SNEAKERS.uuid,
          productName: SNEAKERS.name,
          requestedQuantity: 5,
          availableQuantity: 3,
          deficit: 2,
        },
      ]);
    });

    /**
     * Un faltante bloqueante deja la venta lista para mandarse igual: lo que decide es el diálogo,
     * y la pantalla necesita el botón habilitado para poder abrirlo.
     */
    it('marks the shortage as blocking only where the branch blocks it', () => {
      expect(cart.hasBlockingShortage()).toBe(false);
      expect(cart.isReadyToCommit()).toBe(true);

      cart.setStockValidationPolicy('STRICT_BLOCK');

      expect(cart.hasBlockingShortage()).toBe(true);
      expect(cart.isReadyToCommit()).toBe(true);
    });

    it('does not report shortages when the branch sells into the negative on purpose', () => {
      cart.setStockValidationPolicy('FORCE_SALE');

      expect(cart.hasBlockingShortage()).toBe(false);
      expect(cart.isReadyToCommit()).toBe(true);
    });

    /**
     * Un comprobante sin efecto sobre el stock —una orden de venta, un presupuesto— no descarga
     * mercadería, así que el backend no valida el inventario y la pantalla tampoco puede bloquear.
     */
    it('does not block on a shortage when the voucher moves no stock', () => {
      cart.setStockValidationPolicy('STRICT_BLOCK');
      expect(cart.hasBlockingShortage()).toBe(true);

      cart.setVoucher({
        uuid: 'sale-order-uuid',
        name: 'Orden de venta',
        operationType: 'SALE',
        stockEffect: 'NONE',
        balanceEffect: 'NONE',
      });

      expect(cart.hasBlockingShortage()).toBe(false);
      expect(cart.isReadyToCommit()).toBe(true);
    });
  });

  /** El cliente y el comprobante sobreviven a la venta: el mostrador sigue siendo el mismo. */
  it('empties the lines and the payments but keeps the counterparty', () => {
    cart.addProduct(SNEAKERS);
    cart.addPayment(CASH, 54450);
    cart.setCustomer(WHOLESALE_CUSTOMER);

    cart.clearCart();

    expect(cart.isEmpty()).toBe(true);
    expect(cart.payments()).toHaveLength(0);
    expect(cart.customer()).toBe(WHOLESALE_CUSTOMER);
    expect(cart.voucher()).not.toBeNull();
  });

  describe('operation date', () => {
    it('starts on the current instant', () => {
      const before = Date.now();

      expect(new DirectSaleCart().dateOperation().getTime()).toBeGreaterThanOrEqual(before);
    });

    /**
     * Vaciar el carrito es corregir la venta que se está armando, no empezar otra: la fecha que el
     * operador puso a mano sigue valiendo. Quien la devuelve al ahora es la pantalla, recién cuando
     * el commit cerró.
     */
    it('keeps the date the operator set when the cart is cleared', () => {
      const date = new Date('2026-08-10T09:30:00');
      cart.setDateOperation(date);
      cart.addProduct(SNEAKERS);

      cart.clearCart();

      expect(cart.dateOperation()).toBe(date);
    });
  });

  describe('note', () => {
    it('starts empty and keeps what was written', () => {
      expect(cart.observations()).toBe('');

      cart.setObservations('Se entrega el lunes en el depósito.');

      expect(cart.observations()).toBe('Se entrega el lunes en el depósito.');
    });

    /**
     * Igual que la fecha: vaciar el carrito es corregir la venta que se está armando, y la nota es
     * de esa venta. Quien la suelta es la pantalla, recién cuando el commit cerró.
     */
    it('keeps the note when the cart is cleared', () => {
      cart.addProduct(SNEAKERS);
      cart.setObservations('Retira el cliente.');

      cart.clearCart();

      expect(cart.observations()).toBe('Retira el cliente.');
    });
  });

  describe('receiver', () => {
    /**
     * `null` no es «consumidor final»: es «nadie lo tocó». La diferencia importa porque con `null`
     * el commit no manda el bloque y el backend copia la ficha del cliente — mandar un bloque vacío
     * significaría lo contrario, que se emite sin receptor.
     */
    it('starts untouched so the backend resolves it from the customer', () => {
      cart.setCustomer(WHOLESALE_CUSTOMER);

      expect(cart.receiver()).toBeNull();
    });

    it('keeps what the payment dialog decided', () => {
      cart.setReceiver({ receiverName: 'Juan Pérez', receiverDocType: 'DNI' });

      expect(cart.receiver()).toEqual({ receiverName: 'Juan Pérez', receiverDocType: 'DNI' });
    });

    /**
     * Igual que la nota: vaciar el carrito corrige la venta que se está armando, y el receptor
     * sigue siendo el de esa venta. Quien lo suelta es la pantalla, recién cuando el commit cerró.
     */
    it('keeps the receiver when the cart is cleared', () => {
      cart.addProduct(SNEAKERS);
      cart.setReceiver({ receiverName: 'Juan Pérez' });

      cart.clearCart();

      expect(cart.receiver()).toEqual({ receiverName: 'Juan Pérez' });
    });

    /**
     * Cambiar de cliente sí lo suelta, y es la diferencia con la nota: lo cargado era la ficha del
     * anterior, así que arrastrarlo facturaría a nombre de quien ya no está comprando.
     */
    it('releases the receiver when the customer changes', () => {
      cart.setReceiver({ receiverName: 'Juan Pérez', receiverDocNumber: '20111222' });

      cart.setCustomer(WHOLESALE_CUSTOMER);

      expect(cart.receiver()).toBeNull();
    });

    it('also releases it when the customer is cleared back to the counter sale', () => {
      cart.setCustomer(WHOLESALE_CUSTOMER);
      cart.setReceiver({ receiverName: 'Otra Razón Social SRL' });

      cart.setCustomer(null);

      expect(cart.receiver()).toBeNull();
    });
  });

  /**
   * El kit no tiene saldo propio: su disponible se deriva de los componentes, y el faltante que la
   * pantalla anticipa tiene que salir de ahí (RN-07). Con el `totalStock` en `null` de un producto
   * sin stock, la cuenta vieja daba «faltan todos».
   */
  describe('kits', () => {
    beforeEach(() => {
      cart.addProduct(BREAKFAST_KIT, 5);
      cart.addPayment(CASH, 999999);
    });

    it('does not invent a shortage while the composition has not arrived', () => {
      expect(cart.lineViews()[0].shortage).toBe(0);
      expect(cart.shortages()).toEqual([]);
    });

    it('measures the shortage against the derived availability', () => {
      cart.setKitInfo(BREAKFAST_KIT.uuid, {
        availability: 4,
        components: [
          { uuid: 'coffee', name: 'Café molido', quantity: 1, stock: 10, limitsAvailability: true },
          { uuid: 'juice', name: 'Jugo naranja', quantity: 1, stock: 4, limitsAvailability: true },
        ],
      });

      expect(cart.lineViews()[0].shortage).toBe(1);
    });

    /**
     * Lo que falta es de un componente, no del combo: «faltan 3 Combo Desayuno» no le dice al
     * mostrador qué reponer, y no es lo que va a contestar el backend.
     */
    it('names the component that fell short, not the kit', () => {
      cart.setKitInfo(BREAKFAST_KIT.uuid, {
        availability: 4,
        components: [
          { uuid: 'coffee', name: 'Café molido', quantity: 1, stock: 10, limitsAvailability: true },
          { uuid: 'juice', name: 'Jugo naranja', quantity: 1, stock: 4, limitsAvailability: true },
        ],
      });

      expect(cart.shortages()).toEqual([
        {
          productUuid: 'juice',
          productName: 'Jugo naranja',
          requestedQuantity: 5,
          availableQuantity: 4,
          deficit: 1,
        },
      ]);
    });

    /** Un servicio dentro del combo no tiene saldo: se saltea del mínimo en vez de agotarlo. */
    it('expands the components to the line quantity and skips the ones without stock', () => {
      cart.setKitInfo(BREAKFAST_KIT.uuid, {
        availability: 10,
        components: [
          { uuid: 'croissant', name: 'Medialunas', quantity: 6, stock: 60, limitsAvailability: true },
          { uuid: 'service', name: 'Servicio', quantity: 1, stock: null, limitsAvailability: false },
        ],
      });

      const components = cart.lineViews()[0].kitComponents;
      expect(components[0].requiredQuantity).toBe(30);
      expect(components[0].shortage).toBe(0);
      expect(components[1].shortage).toBe(0);
    });
  });

  /**
   * El kit **armado** no es un combo: existe en el estante. Su línea no explota, así que anticiparle
   * el faltante de los componentes le inventaba un problema que el backend nunca iba a reportar — y
   * con la sucursal en `STRICT_BLOCK` frenaba una venta que del otro lado cerraba sin problema.
   */
  describe('kits armados', () => {
    it('measures the shortage against its own stock, not against the components', () => {
      cart.addProduct(ASSEMBLED_PC, 2);
      cart.addPayment(CASH, 999999);

      expect(cart.lineViews()[0].shortage).toBe(0);
      expect(cart.shortages()).toEqual([]);
    });

    it('reports the shortage as its own, naming the assembled kit', () => {
      cart.addProduct(ASSEMBLED_PC, 5);
      cart.addPayment(CASH, 999999);

      expect(cart.lineViews()[0].shortage).toBe(2);
      expect(cart.shortages()).toEqual([
        {
          productUuid: ASSEMBLED_PC.uuid,
          productName: 'PC Armada 1',
          requestedQuantity: 5,
          availableQuantity: 3,
          deficit: 2,
        },
      ]);
    });

    /**
     * Aunque llegue la composición —el mismo endpoint la devuelve para los dos modos—, el disponible
     * derivado no manda acá: los componentes ya se consumieron al armarlo.
     */
    it('ignores the derived availability even when the composition arrives', () => {
      cart.addProduct(ASSEMBLED_PC, 2);
      cart.addPayment(CASH, 999999);
      cart.setKitInfo(ASSEMBLED_PC.uuid, {
        availability: 0,
        components: [
          { uuid: 'ssd', name: 'SSD 120GB', quantity: 1, stock: 0, limitsAvailability: true },
        ],
      });

      expect(cart.lineViews()[0].shortage).toBe(0);
      expect(cart.shortages()).toEqual([]);
    });

    it('does not block the sale when the branch is STRICT_BLOCK and there is stock', () => {
      cart.addProduct(ASSEMBLED_PC, 3);
      cart.addPayment(CASH, 999999);
      cart.setStockValidationPolicy('STRICT_BLOCK');
      cart.setKitInfo(ASSEMBLED_PC.uuid, {
        availability: 0,
        components: [
          { uuid: 'ssd', name: 'SSD 120GB', quantity: 1, stock: 0, limitsAvailability: true },
        ],
      });

      expect(cart.hasBlockingShortage()).toBe(false);
    });
  });

  /**
   * Un producto sin control de existencias informa `totalStock: null` porque la pregunta no aplica.
   * Tratarlo como cero le inventaba un faltante a cada servicio vendido, y con la sucursal en
   * `STRICT_BLOCK` eso frenaba la venta.
   */
  it('never reports a shortage for a product that does not track stock', () => {
    cart.addProduct(ASSEMBLY_SERVICE, 3);
    cart.setStockValidationPolicy('STRICT_BLOCK');

    expect(cart.lineViews()[0].shortage).toBe(0);
    expect(cart.hasBlockingShortage()).toBe(false);
  });

  /**
   * La lista fijada era de esa venta. Heredarla es cobrarle al cliente siguiente con una lista que
   * alguien eligió hace media hora para otra cosa, y sin nada que lo haga notar.
   */
  it('releases the pinned cart list once the sale is over', () => {
    cart.addProduct(SNEAKERS);
    cart.setCartPriceList(WHOLESALE);

    cart.clearCart();
    cart.addProduct(SNEAKERS);

    expect(cart.cartPriceListUuid()).toBeNull();
    expect(cart.lines()[0].unitPrice).toBe(45000);
  });

  /**
   * Las promociones. El carrito no las va a buscar: se las deja la pantalla, igual que las listas de
   * precios y el detalle de los kits, y de ahí en más el descuento es estado derivado.
   *
   * Los casos describen **lo que el vendedor ve**: qué línea recibió qué, cuánto bajó el total y qué
   * dice el desglose. Que el motor se haya llamado no lo prueba ninguno: eso ya está probado contra
   * los fixtures compartidos, en `promotion-engine-fixtures.spec.ts`.
   */
  describe('promotions', () => {
    beforeEach(() => {
      cart.setCategoryChains(CATEGORY_CHAINS);
      cart.setBranch(BRANCH);
    });

    it('discounts the line the promotion reaches and lowers the total', () => {
      cart.addProduct(SNEAKERS);
      cart.addProduct(SOCKS, 2);
      cart.setPromotions([
        promotion({ uuid: 'p-10', name: '10% en zapatillas', percent: 10, products: [ref(SNEAKERS)] }),
      ]);

      const [sneakers, socks] = cart.lineViews();
      expect(sneakers.amounts?.discountAmount).toBeCloseTo(4500, 2);
      expect(socks.amounts?.discountAmount).toBe(0);
      expect(socks.promotions).toEqual([]);

      // 45.000 − 4.500 = 40.500 de zapatillas, más 10.000 de medias, más el IVA de los dos.
      expect(cart.totals()).toMatchObject({ netAmount: 50500, taxAmount: 10605 });
      expect(cart.totals().totalAmount).toBeCloseTo(61105, 2);
      expect(cart.totals().discountAmount).toBeCloseTo(4500, 2);
    });

    /** El chip lleva el nombre y el detalle corto: es lo que el vendedor le lee al cliente. */
    it('marks the reached line with a chip that names the promotion', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({ uuid: 'p-10', name: '10% en zapatillas', percent: 10, products: [ref(SNEAKERS)] }),
      ]);

      expect(cart.lineViews()[0].promotions).toEqual([
        {
          promotionKey: 'p-10',
          name: '10% en zapatillas',
          detail: { kind: 'PERCENTAGE', percent: 10 },
          amount: 4500,
          bonusQuantity: 0,
        },
      ]);
    });

    /** Una categoría alcanza todo su subárbol: `Calzado` incluye a las zapatillas de `Running`. */
    it('reaches a product through an ancestor category', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({
          uuid: 'p-cat',
          name: '10% en calzado',
          percent: 10,
          categories: [{ uuid: FOOTWEAR, name: 'Calzado' }],
        }),
      ]);

      expect(cart.lineViews()[0].amounts?.discountAmount).toBeCloseTo(4500, 2);
    });

    it('accumulates two promotions on the same line as separate chips', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({ uuid: 'p-10', name: '10% en zapatillas', percent: 10, products: [ref(SNEAKERS)] }),
        promotion({ uuid: 'p-5', name: '5% de temporada', percent: 5, products: [ref(SNEAKERS)] }),
      ]);

      expect(cart.lineViews()[0].promotions.map((applied) => applied.promotionKey)).toEqual([
        'p-10',
        'p-5',
      ]);
    });

    /** RN-02: en cascada. 10% y 5% descuentan 14,5%, no 15%. */
    it('cascades two combinable percentages instead of adding them up', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({ uuid: 'p-10', name: '10%', percent: 10, products: [ref(SNEAKERS)] }),
        promotion({ uuid: 'p-5', name: '5%', percent: 5, products: [ref(SNEAKERS)] }),
      ]);

      // 45.000 × 0,9 = 40.500; 40.500 × 0,95 = 38.475. Sumar los porcentajes daría 38.250.
      expect(cart.lineViews()[0].amounts?.netAmount).toBeCloseTo(38475, 2);
      expect(cart.totals().discountAmount).toBeCloseTo(6525, 2);
    });

    /**
     * RN-03: el importe bonificado se registra en la línea de la unidad que quedó en $0, que es la
     * más barata del bloque — no en la del producto más caro, que es donde el vendedor no lo
     * buscaría y donde el cliente no lo entendería.
     */
    it('marks the bonused unit on its own line, not on the most expensive one', () => {
      cart.addProduct(MUG, 2);
      cart.addProduct(SOCKS, 1);
      cart.setPromotions([
        promotion({
          uuid: 'p-3x2',
          name: '3x2 en accesorios',
          type: 'NXM',
          buyQuantity: 3,
          payQuantity: 2,
          isCombinable: false,
          products: [ref(MUG), ref(SOCKS)],
        }),
      ]);

      const [mugs, socks] = cart.lineViews();
      expect(mugs.promotions).toEqual([]);
      expect(mugs.amounts?.discountAmount).toBe(0);
      expect(socks.promotions).toEqual([
        {
          promotionKey: 'p-3x2',
          name: '3x2 en accesorios',
          detail: { kind: 'NXM', buyQuantity: 3, payQuantity: 2 },
          amount: 5000,
          bonusQuantity: 1,
        },
      ]);
    });

    it('brings the customer promotions in and out with the customer', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({
          uuid: 'p-vip',
          name: 'Cliente mayorista',
          percent: 10,
          products: [ref(SNEAKERS)],
          customers: [{ uuid: WHOLESALE_CUSTOMER.uuid, name: WHOLESALE_CUSTOMER.name }],
        }),
      ]);

      expect(cart.lineViews()[0].promotions).toEqual([]);

      cart.setCustomer(WHOLESALE_CUSTOMER);
      // Con el mayorista cambia además la lista: 38.000 × 10%.
      expect(cart.lineViews()[0].amounts?.discountAmount).toBeCloseTo(3800, 2);

      cart.setCustomer(null);
      expect(cart.lineViews()[0].promotions).toEqual([]);
    });

    /** RN-12: la vigencia se mide contra la fecha de la operación, no contra el hoy del navegador. */
    it('judges the validity against the operation date', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({
          uuid: 'p-week',
          name: 'Semana de la zapatilla',
          percent: 10,
          products: [ref(SNEAKERS)],
          validFrom: '2026-01-05',
          validUntil: '2026-01-11',
        }),
      ]);

      cart.setDateOperation(new Date(2026, 0, 8, 10, 30));
      expect(cart.lineViews()[0].amounts?.discountAmount).toBeCloseTo(4500, 2);

      cart.setDateOperation(new Date(2026, 0, 12, 10, 30));
      expect(cart.lineViews()[0].promotions).toEqual([]);
    });

    /** Una promoción restringida a otra sucursal no descuenta en la que está atendiendo. */
    it('leaves out a promotion restricted to another branch', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({
          uuid: 'p-other',
          name: 'Sólo en Centro',
          percent: 10,
          products: [ref(SNEAKERS)],
          branches: [{ uuid: 'other-branch-uuid', name: 'Centro' }],
        }),
      ]);

      expect(cart.lineViews()[0].promotions).toEqual([]);
    });

    /**
     * RN-18: el motor sólo mira líneas padre. Los componentes de un kit virtual no son unidades
     * elegibles — el precio del combo ya salió de ellos, y descontarles otra vez sería descontar dos
     * veces sobre la misma mercadería.
     */
    it('does not discount a virtual kit through its components', () => {
      cart.addProduct(BREAKFAST_KIT, 2);
      cart.setKitInfo(BREAKFAST_KIT.uuid, {
        availability: 10,
        components: [
          { uuid: SOCKS.uuid, name: SOCKS.name, quantity: 1, stock: 10, limitsAvailability: true },
        ],
      });
      cart.setPromotions([
        promotion({ uuid: 'p-socks', name: '10% en medias', percent: 10, products: [ref(SOCKS)] }),
      ]);

      expect(cart.lineViews()[0].promotions).toEqual([]);
      expect(cart.totals().discountAmount).toBe(0);
      expect(cart.totals().totalAmount).toBeCloseTo(8470, 2);
    });

    describe('conditioned by payment method', () => {
      const CASH_TEN: SalePromotionDto = promotion({
        uuid: 'p-cash',
        name: '10% pagando en efectivo',
        scope: 'ORDER_TOTAL',
        percent: 10,
        paymentMethods: [{ uuid: CASH.uuid, name: CASH.name }],
      });

      beforeEach(() => {
        cart.addProduct(SNEAKERS);
        cart.addProduct(SOCKS, 2);
        cart.setPromotions([CASH_TEN]);
      });

      /**
       * Sin pagos todavía no se aplica, pero se anticipa: es lo que el vendedor le ofrece al cliente
       * **antes** de cobrar, y por eso se dibuja como algo que no está aplicado.
       */
      it('offers the discount as a suggestion while there are no payments', () => {
        expect(cart.totals().totalAmount).toBeCloseTo(66550, 2);
        expect(cart.promotionBreakdown()).toEqual([
          {
            promotionKey: 'p-cash',
            name: '10% pagando en efectivo',
            detail: { kind: 'PERCENTAGE', percent: 10 },
            amount: 6655,
            status: 'SUGGESTED',
            requiredMethods: ['Efectivo'],
          },
        ]);
      });

      it('applies it once the charge is loaded with a method of the set', () => {
        cart.addPayment(CASH, 59895);

        expect(cart.totals().totalAmount).toBeCloseTo(59895, 2);
        expect(cart.totals().discountAmount).toBeCloseTo(6655, 2);
        expect(cart.remainingAmount()).toBeCloseTo(0, 2);
        expect(cart.isFullyPaid()).toBe(true);
        expect(cart.promotionBreakdown()[0]).toMatchObject({
          status: 'APPLIED',
          amount: 6655,
        });
      });

      /**
       * RN-17 es todo-o-nada: un solo pago con un medio ajeno la desactiva entera. El total vuelve a
       * subir y el restante se recalcula, que es lo que el diálogo tiene que poder explicar.
       */
      it('drops it when a payment with a foreign method comes in, and recomputes the balance', () => {
        cart.addPayment(CASH, 59895);
        cart.addPayment(CARD, 1000);

        expect(cart.totals().totalAmount).toBeCloseTo(66550, 2);
        expect(cart.totals().discountAmount).toBe(0);
        expect(cart.remainingAmount()).toBeCloseTo(5655, 2);
        expect(cart.isFullyPaid()).toBe(false);
      });

      /**
       * Una condicionada que **no** se cayó por los medios —se pagó justo como pide, y perdió el
       * desempate de RN-06 contra otra no acumulable del mismo conjunto— no es una caída: decirle al
       * vendedor «requiere pagar con Efectivo» mientras está cobrando en efectivo le da como consejo
       * lo que ya está haciendo.
       */
      it('does not blame the payment method for a promotion that simply lost the tie-break', () => {
        cart.setPromotions([
          promotion({
            uuid: 'p-cash-5',
            name: '5% en efectivo',
            scope: 'ORDER_TOTAL',
            percent: 5,
            isCombinable: false,
            paymentMethods: [{ uuid: CASH.uuid, name: CASH.name }],
          }),
          promotion({
            uuid: 'p-cash-20',
            name: '20% en efectivo',
            scope: 'ORDER_TOTAL',
            percent: 20,
            isCombinable: false,
            paymentMethods: [{ uuid: CASH.uuid, name: CASH.name }],
          }),
        ]);
        cart.addPayment(CASH, 53240);

        // Gana la de mayor descuento; la otra no aparece, porque no hay nada que aconsejar.
        expect(cart.promotionBreakdown()).toEqual([
          {
            promotionKey: 'p-cash-20',
            name: '20% en efectivo',
            detail: { kind: 'PERCENTAGE', percent: 20 },
            amount: 13310,
            status: 'APPLIED',
            requiredMethods: ['Efectivo'],
          },
        ]);
      });

      /** La caída no se esconde: se muestra en $0 y con el motivo, o el total sube sin explicación. */
      it('keeps the dropped promotion in the breakdown, at zero and with its reason', () => {
        cart.addPayment(CARD, 66550);

        expect(cart.promotionBreakdown()).toEqual([
          {
            promotionKey: 'p-cash',
            name: '10% pagando en efectivo',
            detail: { kind: 'PERCENTAGE', percent: 10 },
            amount: 0,
            status: 'DROPPED',
            requiredMethods: ['Efectivo'],
          },
        ]);
      });

      /** Quitar el pago ajeno la devuelve: el recálculo va en los dos sentidos. */
      it('brings it back when the foreign payment is removed', () => {
        cart.addPayment(CASH, 59895);
        cart.addPayment(CARD, 1000);
        cart.removePayment(1);

        expect(cart.totals().totalAmount).toBeCloseTo(59895, 2);
        expect(cart.isFullyPaid()).toBe(true);
      });
    });

    /**
     * El caso borde de RN-17: un descuento condicionado que dejaría el total en $0 dejaría la venta
     * sin pagos, y sin pagos la condición no se cumple. El punto estable es **sin** esa promoción:
     * el carrito tiene que quedarse ahí, no oscilar entre los dos totales.
     */
    it('settles without the promotion when it would leave nothing to charge', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({
          uuid: 'p-free',
          name: 'Todo gratis en efectivo',
          scope: 'ORDER_TOTAL',
          percent: 100,
          paymentMethods: [{ uuid: CASH.uuid, name: CASH.name }],
        }),
      ]);
      cart.addPayment(CASH, 54450);

      expect(cart.totals().totalAmount).toBeCloseTo(54450, 2);
      expect(cart.isFullyPaid()).toBe(true);
    });

    /** El cobro cierra contra el total **ya descontado**: exigir el de lista cobraría de más. */
    it('requires payments that close against the discounted total', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({ uuid: 'p-10', name: '10%', percent: 10, products: [ref(SNEAKERS)] }),
      ]);

      // 45.000 − 4.500 = 40.500, más 21% = 49.005.
      cart.addPayment(CASH, 49000);
      expect(cart.isReadyToCommit()).toBe(false);

      cart.setPayments([{ paymentMethod: CASH, amount: 49005 }]);
      expect(cart.isReadyToCommit()).toBe(true);
    });

    /** El recálculo es automático: cambiar una cantidad no necesita que nadie apriete nada. */
    it('recomputes the discount when a quantity changes', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({ uuid: 'p-10', name: '10%', percent: 10, products: [ref(SNEAKERS)] }),
      ]);
      cart.setQuantity(SNEAKERS.uuid, 3);

      expect(cart.lineViews()[0].amounts?.discountAmount).toBeCloseTo(13500, 2);
    });

    /** Una promoción discontinuada no descuenta, aunque sus fechas la den por vigente. */
    it('ignores a discontinued promotion', () => {
      cart.addProduct(SNEAKERS);
      cart.setPromotions([
        promotion({
          uuid: 'p-off',
          name: '10%',
          percent: 10,
          products: [ref(SNEAKERS)],
          isDiscontinued: true,
        }),
      ]);

      expect(cart.lineViews()[0].promotions).toEqual([]);
    });
  });
});
