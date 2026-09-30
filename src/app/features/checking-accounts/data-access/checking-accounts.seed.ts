import { AllocationMode, DocType, PartyRole } from './checking-account.model';

/**
 * El juego de datos con el que arranca el módulo.
 *
 * Es una **semilla**, no un listado congelado: todas las fechas se declaran en días relativos a hoy
 * y se resuelven al arrancar, así que una deuda emitida hace 95 días con 30 de plazo aparece
 * vencida hace 65 sin importar cuándo se abra la app. Es lo que hace demostrable la regla de §7.1
 * —la deuda vence sola— en vez de dejarla escrita en un comentario.
 *
 * Los saldos **no** se declaran: los calcula {@link CheckingAccountsMockDb} sumando partidas e
 * imputaciones, de modo que los tres invariantes de §4.3 valgan por construcción y sigan valiendo
 * después de cobrar, imputar, desimputar o anular desde la pantalla.
 */

export interface PolicyValues {
  dueDays: number;
  /** `null` = ilimitado. */
  debtLimit: number | null;
  openDebtLimit: number | null;
  allocationMode: AllocationMode;
  notifyOnDue: boolean;
  dueSoonDays: number;
}

/** El peldaño de abajo de la escalera de §5: lo que rige cuando la empresa no dijo nada. */
export const DEFAULT_POLICY: PolicyValues = {
  dueDays: 30,
  debtLimit: null,
  openDebtLimit: null,
  allocationMode: 'AUTOMATIC',
  notifyOnDue: false,
  dueSoonDays: 3,
};

/** El peldaño del medio: la política de la empresa, editable desde Ajustes. */
export const COMPANY_POLICY: Partial<PolicyValues> = {
  dueDays: 30,
  debtLimit: 500_000,
  allocationMode: 'AUTOMATIC',
  notifyOnDue: true,
  dueSoonDays: 3,
};

export interface PartySeed {
  uuid: string;
  name: string;
  docType: DocType;
  docNumber: string;
  email: string | null;
}

export interface DebtSeed {
  publicId: string;
  origin: 'ORDER' | 'ADJUSTMENT' | 'OPENING_BALANCE' | 'REFUND';
  amount: number;
  /** Días atrás en que se emitió; el vencimiento sale de sumarle `dueDays`. */
  issuedDaysAgo: number;
  /** Plazo con el que nació. Ausente = el de la política resuelta de la cuenta. */
  dueDays?: number;
  /** Prórroga ya aplicada: días que se corrió el vencimiento respecto del original. */
  extendedByDays?: number;
  description: string;
  branchName?: string;
}

export interface CreditPaymentSeed {
  paymentMethodName: string;
  amount: number;
  affectsCashRegister: boolean;
}

export interface CreditSeed {
  publicId: string;
  origin: 'RECEIPT' | 'CREDIT_NOTE' | 'ADJUSTMENT';
  amount: number;
  issuedDaysAgo: number;
  description: string;
  branchName?: string;
  payments?: readonly CreditPaymentSeed[];
}

export interface AllocationSeed {
  /** Índice en `debts` de la cuenta. */
  debt: number;
  /** Índice en `credits` de la cuenta. */
  credit: number;
  amount: number;
  mode: AllocationMode;
  daysAgo: number;
  userName?: string;
}

export interface AccountSeed {
  uuid: string;
  party: PartySeed;
  role: PartyRole;
  enabled?: boolean;
  /** Overrides del titular; lo ausente hereda de la empresa (§5.2). */
  policy?: Partial<PolicyValues>;
  exception?: {
    level: 'AL_DIA' | 'EN_MORA' | 'MOROSO' | 'MOROSO_GRAVE';
    daysUntil: number;
    reason: string;
    authorizedBy: string;
  };
  debts?: readonly DebtSeed[];
  credits?: readonly CreditSeed[];
  allocations?: readonly AllocationSeed[];
}

const CASH = (amount: number): CreditPaymentSeed[] => [
  { paymentMethodName: 'Efectivo', amount, affectsCashRegister: true },
];
const TRANSFER = (amount: number): CreditPaymentSeed[] => [
  { paymentMethodName: 'Transferencia', amount, affectsCashRegister: false },
];

export const ACCOUNT_SEEDS: readonly AccountSeed[] = [
  /* ── La cuenta problemática: vencida hace más de 60 días y con un cobro esperando imputación ── */
  {
    uuid: 'cca-0001',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0001',
      name: 'Distribuidora Sur S.A.',
      docType: 'CUIT',
      docNumber: '30-71234567-8',
      email: 'administracion@distribuidorasur.com.ar',
    },
    // Límite propio y modo manual: es lo que explica que el cobro de abajo siga sin imputar y lo
    // que hace visible en la ficha de qué peldaño salió cada valor.
    policy: { debtLimit: 1_500_000, allocationMode: 'MANUAL' },
    debts: [
      {
        publicId: 'FAC-A-0001-00412',
        origin: 'ORDER',
        amount: 945_600,
        issuedDaysAgo: 95,
        description: 'Venta mostrador — Sucursal Central',
      },
      {
        publicId: 'FAC-A-0001-00456',
        origin: 'ORDER',
        amount: 450_000,
        issuedDaysAgo: 86,
        description: 'Venta mostrador — Sucursal Central',
      },
    ],
    credits: [
      {
        publicId: 'REC-X-0001-00122',
        origin: 'RECEIPT',
        amount: 150_000,
        issuedDaysAgo: 90,
        description: 'Cobro parcial a cuenta',
        payments: CASH(150_000),
      },
      {
        publicId: 'REC-X-0001-00131',
        origin: 'RECEIPT',
        amount: 60_000,
        issuedDaysAgo: 3,
        description: 'Cobro sin imputar — política manual',
        payments: TRANSFER(60_000),
      },
    ],
    allocations: [{ debt: 0, credit: 0, amount: 150_000, mode: 'MANUAL', daysAgo: 90 }],
  },

  /* ── Al día: el caso feliz, con una deuda por vencer dentro de la ventana de aviso ── */
  {
    uuid: 'cca-0002',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0002',
      name: 'Almacén La Esquina',
      docType: 'CUIT',
      docNumber: '27-30412345-4',
      email: 'laesquina@gmail.com',
    },
    debts: [
      {
        publicId: 'FAC-B-0002-00877',
        origin: 'ORDER',
        amount: 128_400,
        issuedDaysAgo: 28,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
      {
        publicId: 'FAC-B-0002-00901',
        origin: 'ORDER',
        amount: 74_250,
        issuedDaysAgo: 6,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
  },

  /* ── Mora leve: permite y advierte ── */
  {
    uuid: 'cca-0003',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0003',
      name: 'Kiosco Don Pedro',
      docType: 'DNI',
      docNumber: '20-14587963-1',
      email: 'donpedro.kiosco@gmail.com',
    },
    policy: { debtLimit: 180_000 },
    debts: [
      {
        publicId: 'FAC-B-0002-00812',
        origin: 'ORDER',
        amount: 46_800,
        issuedDaysAgo: 38,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
      {
        publicId: 'FAC-B-0002-00915',
        origin: 'ORDER',
        amount: 31_500,
        issuedDaysAgo: 4,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
  },

  /* ── Moroso por antigüedad, con una deuda prorrogada a la vista ── */
  {
    uuid: 'cca-0004',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0004',
      name: 'Supermercados Norte S.R.L.',
      docType: 'CUIT',
      docNumber: '30-70998877-2',
      email: 'pagos@supernorte.com.ar',
    },
    policy: { debtLimit: 900_000, openDebtLimit: 5 },
    debts: [
      {
        publicId: 'FAC-A-0001-00388',
        origin: 'ORDER',
        amount: 312_000,
        issuedDaysAgo: 66,
        extendedByDays: 15,
        description: 'Venta mayorista — Sucursal Central',
      },
      {
        publicId: 'FAC-A-0001-00470',
        origin: 'ORDER',
        amount: 190_400,
        issuedDaysAgo: 33,
        description: 'Venta mayorista — Sucursal Central',
      },
      {
        publicId: 'AJU-0001-00007',
        origin: 'ADJUSTMENT',
        amount: 8_600,
        issuedDaysAgo: 20,
        dueDays: 15,
        description: 'Ajuste por diferencia de redondeo histórica',
      },
    ],
    credits: [
      {
        publicId: 'REC-X-0001-00118',
        origin: 'RECEIPT',
        amount: 90_000,
        issuedDaysAgo: 25,
        description: 'Cobro a cuenta',
        payments: TRANSFER(90_000),
      },
    ],
    allocations: [{ debt: 0, credit: 0, amount: 90_000, mode: 'AUTOMATIC', daysAgo: 25 }],
  },

  /* ── Saldo a favor: más crédito sin imputar que deuda pendiente ── */
  {
    uuid: 'cca-0005',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0005',
      name: 'Ferretería El Tornillo',
      docType: 'CUIT',
      docNumber: '20-28654123-7',
      email: 'eltornillo@ferreteria.com.ar',
    },
    debts: [
      {
        publicId: 'FAC-B-0002-00888',
        origin: 'ORDER',
        amount: 54_000,
        issuedDaysAgo: 12,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
    credits: [
      {
        publicId: 'REC-X-0002-00044',
        origin: 'RECEIPT',
        amount: 80_000,
        issuedDaysAgo: 10,
        description: 'Anticipo del cliente',
        branchName: 'Sucursal Norte',
        payments: CASH(80_000),
      },
    ],
    allocations: [{ debt: 0, credit: 0, amount: 54_000, mode: 'AUTOMATIC', daysAgo: 10 }],
  },

  /* ── Moroso con excepción vigente: el nivel manual pisa al calculado hasta su fecha ── */
  {
    uuid: 'cca-0006',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0006',
      name: 'Corralón Los Andes S.A.',
      docType: 'CUIT',
      docNumber: '30-71455678-9',
      email: 'cuentas@corralonlosandes.com.ar',
    },
    policy: { debtLimit: 750_000 },
    exception: {
      level: 'EN_MORA',
      daysUntil: 18,
      reason: 'Discusión de facturación por remito 0001-3345 en curso',
      authorizedBy: 'J. Báez',
    },
    debts: [
      {
        publicId: 'FAC-A-0001-00402',
        origin: 'ORDER',
        amount: 268_000,
        issuedDaysAgo: 58,
        description: 'Venta mayorista — Sucursal Central',
      },
      {
        publicId: 'FAC-A-0001-00489',
        origin: 'ORDER',
        amount: 121_300,
        issuedDaysAgo: 18,
        description: 'Venta mayorista — Sucursal Central',
      },
    ],
  },

  {
    uuid: 'cca-0007',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0007',
      name: 'Panadería Santa Rita',
      docType: 'CUIT',
      docNumber: '27-32456789-3',
      email: 'santarita.panaderia@gmail.com',
    },
    policy: { debtLimit: 120_000 },
    debts: [
      {
        publicId: 'FAC-B-0002-00934',
        origin: 'ORDER',
        amount: 18_900,
        issuedDaysAgo: 2,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
  },

  {
    uuid: 'cca-0008',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0008',
      name: 'Autoservicio 24hs',
      docType: 'CUIT',
      docNumber: '30-71887766-5',
      email: 'auto24@servicio.com.ar',
    },
    debts: [
      {
        publicId: 'FAC-B-0002-00790',
        origin: 'ORDER',
        amount: 96_700,
        issuedDaysAgo: 41,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
  },

  /* ── Sin deuda y con la cuenta apagada: el kill switch por titular ── */
  {
    uuid: 'cca-0009',
    role: 'CUSTOMER',
    enabled: false,
    party: {
      uuid: 'party-0009',
      name: 'Mayorista Pampa S.A.',
      docType: 'CUIT',
      docNumber: '33-70223344-9',
      email: null,
    },
    policy: { debtLimit: 2_000_000 },
    debts: [
      {
        publicId: 'SI-0001-00003',
        origin: 'OPENING_BALANCE',
        amount: 240_000,
        issuedDaysAgo: 120,
        dueDays: 90,
        description: 'Saldo inicial de migración',
      },
    ],
  },

  /* ── Proveedores: la misma aritmética, otro cartel (§3.1) ── */
  {
    uuid: 'cca-0010',
    role: 'SUPPLIER',
    party: {
      uuid: 'party-0010',
      name: 'Bebidas del Litoral S.A.',
      docType: 'CUIT',
      docNumber: '30-70112233-4',
      email: 'cobranzas@bebidaslitoral.com.ar',
    },
    policy: { debtLimit: null },
    debts: [
      {
        publicId: 'FAC-A-0044-01120',
        origin: 'ORDER',
        amount: 418_500,
        issuedDaysAgo: 21,
        description: 'Compra de mercadería — Sucursal Central',
      },
    ],
  },

  {
    uuid: 'cca-0011',
    role: 'SUPPLIER',
    party: {
      uuid: 'party-0011',
      name: 'Lácteos del Valle S.A.',
      docType: 'CUIT',
      docNumber: '30-70556677-1',
      email: 'admin@lacteosdelvalle.com.ar',
    },
    debts: [
      {
        publicId: 'FAC-A-0077-00390',
        origin: 'ORDER',
        amount: 236_800,
        issuedDaysAgo: 44,
        description: 'Compra de mercadería — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
      {
        publicId: 'FAC-A-0077-00415',
        origin: 'ORDER',
        amount: 158_200,
        issuedDaysAgo: 9,
        description: 'Compra de mercadería — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
    credits: [
      {
        publicId: 'PAG-X-0001-00061',
        origin: 'RECEIPT',
        amount: 100_000,
        issuedDaysAgo: 30,
        description: 'Pago a cuenta',
        payments: TRANSFER(100_000),
      },
    ],
    allocations: [{ debt: 0, credit: 0, amount: 100_000, mode: 'AUTOMATIC', daysAgo: 30 }],
  },

  {
    uuid: 'cca-0012',
    role: 'SUPPLIER',
    party: {
      uuid: 'party-0012',
      name: 'Papelera Rioplatense',
      docType: 'CUIT',
      docNumber: '30-70889900-6',
      email: 'ventas@papelerarioplatense.com.ar',
    },
    policy: { debtLimit: 300_000 },
    debts: [
      {
        publicId: 'FAC-B-0012-00204',
        origin: 'ORDER',
        amount: 74_300,
        issuedDaysAgo: 39,
        description: 'Compra de insumos — Sucursal Central',
      },
    ],
  },

  /* ── El tercero con los dos roles: es el único al que se le puede ofrecer compensar (§8.5) ── */
  {
    uuid: 'cca-0013',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0013',
      name: 'Insumos Industriales S.R.L.',
      docType: 'CUIT',
      docNumber: '30-71002244-7',
      email: 'cuentacorriente@insumosind.com.ar',
    },
    policy: { debtLimit: 600_000 },
    debts: [
      {
        publicId: 'FAC-A-0001-00465',
        origin: 'ORDER',
        amount: 214_000,
        issuedDaysAgo: 24,
        description: 'Venta mayorista — Sucursal Central',
      },
    ],
  },
  {
    uuid: 'cca-0014',
    role: 'SUPPLIER',
    party: {
      uuid: 'party-0013',
      name: 'Insumos Industriales S.R.L.',
      docType: 'CUIT',
      docNumber: '30-71002244-7',
      email: 'cuentacorriente@insumosind.com.ar',
    },
    debts: [
      {
        publicId: 'FAC-A-0099-00812',
        origin: 'ORDER',
        amount: 146_500,
        issuedDaysAgo: 17,
        description: 'Compra de insumos — Sucursal Central',
      },
    ],
  },

  {
    uuid: 'cca-0015',
    role: 'SUPPLIER',
    party: {
      uuid: 'party-0015',
      name: 'Logística Global S.R.L.',
      docType: 'CUIT',
      docNumber: '30-71554433-0',
      email: 'administracion@logisticaglobal.com.ar',
    },
    policy: { debtLimit: 250_000 },
    debts: [
      {
        publicId: 'FAC-B-0031-00587',
        origin: 'ORDER',
        amount: 132_900,
        issuedDaysAgo: 52,
        description: 'Servicio de flete — Sucursal Central',
      },
    ],
    credits: [
      {
        publicId: 'NC-A-0031-00012',
        origin: 'CREDIT_NOTE',
        amount: 12_400,
        issuedDaysAgo: 15,
        description: 'Nota de crédito por flete no prestado',
      },
    ],
  },

  {
    uuid: 'cca-0016',
    role: 'CUSTOMER',
    party: {
      uuid: 'party-0016',
      name: 'Rotisería El Fogón',
      docType: 'CUIT',
      docNumber: '27-33887766-2',
      email: 'elfogon.rotiseria@gmail.com',
    },
    policy: { debtLimit: 90_000 },
    debts: [
      {
        publicId: 'FAC-B-0002-00860',
        origin: 'ORDER',
        amount: 63_400,
        issuedDaysAgo: 47,
        description: 'Venta mostrador — Sucursal Norte',
        branchName: 'Sucursal Norte',
      },
    ],
  },
];

/** Los medios que ofrece el alta de cobro; el mock los sirve como si vinieran de `/payment`. */
export const PAYMENT_METHOD_SEEDS: readonly {
  uuid: string;
  name: string;
  affectsCashRegister: boolean;
}[] = [
  { uuid: 'pm-cash', name: 'Efectivo', affectsCashRegister: true },
  { uuid: 'pm-transfer', name: 'Transferencia', affectsCashRegister: false },
  { uuid: 'pm-debit', name: 'Tarjeta de débito', affectsCashRegister: true },
  { uuid: 'pm-credit', name: 'Tarjeta de crédito', affectsCashRegister: false },
  { uuid: 'pm-check', name: 'Cheque', affectsCashRegister: false },
];
