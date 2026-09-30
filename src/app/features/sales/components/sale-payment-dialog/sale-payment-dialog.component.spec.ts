import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountAvailabilityDto } from '../../../../core/checking-accounts/account-availability.model';
import { SalePaymentMethodDto, SalePromotionDto } from '../../data-access/sale.model';
import { SalePayment } from '../../state/direct-sale-cart';
import { SalePromotionContext } from '../../state/sale-checkout';
import { SalePaymentDialogComponent, SalePaymentDialogData } from './sale-payment-dialog.component';

const CASH: SalePaymentMethodDto = { uuid: 'cash-uuid', name: 'Efectivo', code: 'CASH' };
const CARD: SalePaymentMethodDto = { uuid: 'card-uuid', name: 'Tarjeta', code: 'CARD' };
const ACCOUNT: SalePaymentMethodDto = { uuid: 'account-uuid', name: 'Cuenta corriente', code: 'ACCOUNT' };

/** Lo que contesta `/availability`: un cliente con tope de 100.000 y 20.000 sin usar. */
const AVAILABILITY: AccountAvailabilityDto = {
  accountUuid: 'checking-account-uuid',
  partyName: 'Distribuidora Sur',
  operation: 'SALE',
  allowed: true,
  blockedReason: null,
  balance: 80000,
  overdueAmount: 0,
  debtLimit: 100000,
  available: 2000,
  delinquencyLevel: 'AL_DIA',
  enabled: true,
};

/**
 * La venta que se está por cobrar, en la forma que el motor evalúa: una línea de $3.000 más IVA.
 *
 * El diálogo recibe la venta y no un total ya calculado porque con una promoción condicionada por
 * medio de pago **el total depende de con qué se paga**, y se paga acá adentro.
 */
const SALE_TOTAL = 3630;

const SALE: SalePromotionContext = {
  lines: [
    {
      index: 0,
      productKey: 'product-uuid',
      quantity: 1,
      unitPrice: 3000,
      net: 3000,
      taxAmount: 630,
      subtotal: 3630,
    },
  ],
  promotions: [],
  operationDate: '2026-09-18',
  customerKey: null,
  branchKey: null,
};

/** Un 10 % sobre el total, pero sólo si toda la venta se paga en efectivo (RN-17). */
const CASH_TEN: SalePromotionDto = {
  uuid: 'promo-cash',
  name: '10% pagando en efectivo',
  type: 'PERCENTAGE',
  scope: 'ORDER_TOTAL',
  percent: 10,
  validFrom: '2020-01-01',
  paymentMethods: [{ uuid: CASH.uuid, name: CASH.name }],
};

describe('SalePaymentDialogComponent', () => {
  let fixture: ComponentFixture<SalePaymentDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

  /** El de confirmar es el último de las acciones; el primero es el de cancelar. */
  const confirmButton = (): HTMLButtonElement =>
    [...host().querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')].at(-1)!;

  /**
   * Acotado al bloque de cobro a propósito: el diálogo tiene otro `mat-select` —el tipo de documento
   * del receptor— que aparece cuando ese bloque está abierto, y un selector suelto se quedaba con él.
   */
  const methodSelect = (): HTMLElement =>
    host().querySelector('.payments__draft-method mat-select')!;

  const amountInput = (): HTMLInputElement =>
    host().querySelector<HTMLInputElement>('.payments__draft-amount input')!;

  /** Elige el medio del desplegable, sin agregar el tramo: es donde se ve lo que la pantalla propone. */
  const chooseMethod = (method: SalePaymentMethodDto): void => {
    methodSelect().click();
    fixture.detectChanges();

    const option = [...document.querySelectorAll<HTMLElement>('mat-option')].find((item) =>
      item.textContent?.includes(method.name),
    );
    option?.click();
    fixture.detectChanges();
  };

  /** Elige el medio del desplegable y agrega el tramo por el importe que haya propuesto la pantalla. */
  const addPayment = (method: SalePaymentMethodDto, amount?: number): void => {
    chooseMethod(method);

    if (amount !== undefined) {
      const input = amountInput();
      input.value = String(amount);
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    host().querySelector<HTMLButtonElement>('.payments__draft-add')!.click();
    fixture.detectChanges();
  };

  const create = (data: Partial<SalePaymentDialogData> = {}): void => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideTranslateService(),
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            paymentMethods: [CASH, CARD],
            promotionContext: SALE,
            payments: [],
            customer: null,
            receiver: null,
            availability: null,
            ...data,
          } satisfies SalePaymentDialogData,
        },
      ],
    });

    fixture = TestBed.createComponent(SalePaymentDialogComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    close = vi.fn();
  });

  it('no deja confirmar hasta que el cobro cubre el total', () => {
    create();
    expect(confirmButton().disabled).toBe(true);

    // Un tramo parcial: sigue faltando y sigue sin poder confirmarse.
    addPayment(CARD, 3000);
    expect(confirmButton().disabled).toBe(true);

    addPayment(CASH);
    expect(confirmButton().disabled).toBe(false);
  });

  /** El importe propuesto es lo que falta: un solo medio salda la venta sin escribir el número. */
  it('confirma con los tramos armados', () => {
    create();

    addPayment(CASH);
    confirmButton().click();

    expect(close).toHaveBeenCalledTimes(1);
    // El receptor va en `null`: nadie lo tocó, así que el commit no manda el bloque y lo resuelve
    // el backend desde la ficha del cliente.
    expect(close.mock.calls[0][0]).toEqual({
      payments: [{ paymentMethod: CASH, amount: SALE_TOTAL }],
      receiver: null,
    });
  });

  /** Un cobro que quedó de un intento anterior se retoma tal cual, sin rearmarlo. */
  it('arranca con los pagos que ya venían', () => {
    const previous: SalePayment[] = [{ paymentMethod: CASH, amount: SALE_TOTAL }];
    create({ payments: previous });

    expect(confirmButton().disabled).toBe(false);

    confirmButton().click();
    expect(close.mock.calls[0][0]).toEqual({ payments: previous, receiver: null });
  });

  /**
   * El receptor del comprobante se decide en este paso, así que sale por acá. Editado en el diálogo,
   * viaja entero; intacto, viaja `null` y el backend copia la ficha del cliente.
   */
  it('devuelve el receptor editado junto con el cobro', () => {
    const receiver = { receiverName: 'Otra Razón Social SRL', receiverDocNumber: '30999888777' };
    create({ receiver });

    addPayment(CASH);
    confirmButton().click();

    expect(close.mock.calls[0][0]).toEqual({
      payments: [{ paymentMethod: CASH, amount: SALE_TOTAL }],
      receiver,
    });
  });

  it('cobrar de más deja de reclamar saldo y anuncia el vuelto', () => {
    create();

    addPayment(CASH, 4000);

    const balance = host().querySelector('.payment-dialog__balance')?.textContent ?? '';
    expect(balance).toContain('sales.totals.change');
    expect(balance).not.toContain('sales.totals.remaining');
    expect(confirmButton().disabled).toBe(false);
  });

  /* ─────────────────────────  El medio «cuenta corriente» (VTY-424)  ───────────────────────── */

  /**
   * «El medio precarga el disponible y deja dividir el pago.»
   *
   * Con el disponible por debajo del total, la pantalla propone el disponible y no el total: el
   * resto queda para otro medio, que es la diferencia entre un cobro que se arma solo y un «no se
   * puede» a secas que manda al cajero a llamar por teléfono.
   */
  it('la cuenta corriente precarga el disponible, no el total', () => {
    create({ paymentMethods: [CASH, ACCOUNT], availability: AVAILABILITY });

    chooseMethod(ACCOUNT);

    expect(Number(amountInput().value)).toBe(2000);
    // Y dice de dónde salió ese número: un importe más chico que el total y sin explicación se lee
    // como un error de la pantalla.
    expect(host().textContent).toContain('sales.payments.accountAvailable');
  });

  /** Y el resto se cobra con otro medio: el pago se divide y la venta se cierra igual. */
  it('deja dividir el pago entre la cuenta y otro medio', () => {
    create({ paymentMethods: [CASH, ACCOUNT], availability: AVAILABILITY });

    addPayment(ACCOUNT);
    // El tramo siguiente vuelve a proponer lo que falta, ya sin techo: el efectivo no tiene tope.
    addPayment(CASH);

    expect(confirmButton().disabled).toBe(false);
    confirmButton().click();
    expect(close.mock.calls[0][0].payments).toEqual([
      { paymentMethod: ACCOUNT, amount: 2000 },
      { paymentMethod: CASH, amount: SALE_TOTAL - 2000 },
    ]);
  });

  /**
   * El caso que no existe en ninguna otra pantalla del sistema: **el total cambia según con qué se
   * paga**. Cada alta y cada baja de un tramo re-evalúa el motor, así que el diálogo tiene que poder
   * contar los dos sentidos — el descuento que entra y el que se cae — sin que el vendedor tenga que
   * cerrarlo y volver a abrirlo.
   */
  describe('promociones condicionadas por medio de pago', () => {
    /**
     * El motivo de la caída se lee, no se infiere: es la única parte del diálogo cuyo texto **es** la
     * funcionalidad —«requiere pagar con Efectivo» es lo que el vendedor le ofrece al cliente para
     * recuperar el descuento—, así que el caso lo prueba con la traducción cargada de verdad.
     */
    const withReasons = (): void => {
      const translate = TestBed.inject(TranslateService);
      translate.setTranslation('es', {
        sales: {
          totals: {
            promotionSuggested: 'Se aplicaría pagando con {{methods}}',
            promotionDropped: 'No se aplicó: requiere pagar con {{methods}}',
          },
        },
      });
      translate.use('es');
    };

    /** El total y el desglose, como los ve el vendedor. */
    const totalText = (): string => host().querySelector('.payment-dialog__total')!.textContent!;
    const promotionRows = (): HTMLElement[] => [
      ...host().querySelectorAll<HTMLElement>('.promotion-breakdown__row'),
    ];

    it('anticipa el descuento como algo todavía no aplicado', () => {
      create({ promotionContext: { ...SALE, promotions: [CASH_TEN] } });

      // El total sigue siendo el de lista: la promoción todavía no entró.
      expect(totalText()).toContain('3.630');
      expect(promotionRows()[0].className).toContain('promotion-breakdown__row--suggested');
    });

    it('lo aplica y baja el total al cobrar con el medio que pide', () => {
      create({ promotionContext: { ...SALE, promotions: [CASH_TEN] } });

      addPayment(CASH, 3267);

      expect(totalText()).toContain('3.267');
      expect(promotionRows()[0].className).not.toContain('--suggested');
      expect(confirmButton().disabled).toBe(false);
    });

    /**
     * El camino del sobrepago, que ya existía y tiene que seguir comportándose igual: el vendedor
     * carga el importe **de lista** —es lo que el diálogo propone antes de que el descuento entre—,
     * el descuento entra recién con ese pago y el total baja debajo de lo cobrado.
     *
     * La respuesta correcta es «Vuelto», no «cobro incompleto»: el cliente entregó de más y hay que
     * devolverle la diferencia. Ajustar el tramo solo sería reescribir lo que el vendedor contó.
     */
    it('deja vuelto cuando el descuento entra despues de cargar el importe', () => {
      create({ promotionContext: { ...SALE, promotions: [CASH_TEN] } });

      // Sin importe explícito: entra por lo que la pantalla propone, que todavía es el de lista.
      addPayment(CASH);

      expect(totalText()).toContain('3.267');
      expect(host().querySelector('.payment-dialog__balance')!.textContent).toContain('363');
      expect(confirmButton().disabled).toBe(false);
    });

    /** RN-17 es todo-o-nada: un solo tramo con un medio ajeno la desactiva entera. */
    it('la deja caer con todas las letras cuando entra un medio ajeno', () => {
      create({ promotionContext: { ...SALE, promotions: [CASH_TEN] } });
      withReasons();
      addPayment(CASH, 3267);
      addPayment(CARD, 100);

      // El total volvió a subir, y la promoción caída sigue en la lista para explicarlo. Lo cobrado
      // ya no alcanza: el restante se recalculó sobre el total sin descuento.
      expect(totalText()).toContain('3.630');
      const dropped = promotionRows()[0];
      expect(dropped.className).toContain('promotion-breakdown__row--dropped');
      expect(dropped.textContent).toContain('requiere pagar con Efectivo');
      expect(confirmButton().disabled).toBe(true);
    });
  });

  /**
   * Sin tope no hay techo que aplicar: el medio propone el total como cualquier otro. `null` es «no
   * hay nada que consumir» y no «cero disponible».
   */
  it('sin tope la cuenta corriente propone el total', () => {
    create({
      paymentMethods: [CASH, ACCOUNT],
      availability: { ...AVAILABILITY, debtLimit: null, available: null },
    });

    chooseMethod(ACCOUNT);

    expect(Number(amountInput().value)).toBe(SALE_TOTAL);
  });

  /**
   * «Una cuenta deshabilitada sí deshabilita el medio, con el motivo visible.»
   *
   * El motivo al lado y no sólo el botón en gris: un medio apagado sin explicación manda al cajero a
   * preguntar por qué.
   */
  it('la cuenta deshabilitada no deja agregar el tramo, y dice por que', () => {
    create({
      paymentMethods: [CASH, ACCOUNT],
      availability: {
        ...AVAILABILITY,
        allowed: false,
        blockedReason: 'ACCOUNT_DISABLED',
        enabled: false,
      },
    });

    chooseMethod(ACCOUNT);

    expect(host().querySelector<HTMLButtonElement>('.payments__draft-add')!.disabled).toBe(true);
    expect(host().textContent).toContain('sales.payments.accountDisabled');
  });

  /**
   * Un cliente en el peor peldaño de morosidad cobra a cuenta como cualquier otro: el chip informa y
   * no interrumpe. Es la diferencia entre un estado de gestión y un permiso.
   */
  it('MOROSO_GRAVE no deshabilita el medio', () => {
    create({
      paymentMethods: [CASH, ACCOUNT],
      availability: { ...AVAILABILITY, delinquencyLevel: 'MOROSO_GRAVE' },
    });

    chooseMethod(ACCOUNT);

    expect(host().querySelector<HTMLButtonElement>('.payments__draft-add')!.disabled).toBe(false);
    expect(host().textContent).not.toContain('sales.payments.accountDisabled');
  });

  /**
   * Sin respuesta del backend el medio se ofrece igual, sin techo: quien decide de verdad es el
   * commit, y esconder el medio por una lectura que falló impediría una venta perfectamente válida.
   */
  it('sin disponible leido, la cuenta se ofrece sin techo', () => {
    create({ paymentMethods: [CASH, ACCOUNT], availability: null });

    chooseMethod(ACCOUNT);

    expect(Number(amountInput().value)).toBe(SALE_TOTAL);
    expect(host().querySelector<HTMLButtonElement>('.payments__draft-add')!.disabled).toBe(false);
  });
});
