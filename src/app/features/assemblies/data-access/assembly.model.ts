import { Permission, Permissions } from '../../../core/auth/permissions';

/** Una referencia `{ uuid, name }`, como las devuelve el backend en todo el módulo. */
export interface UuidNameRef {
  uuid: string;
  name: string;
}

/**
 * Estado de un armado. En v1 son **dos**: el armado es un commit atómico —consume y produce en la
 * misma transacción (RN-23)— así que no hay armado en curso. `IN_PROGRESS` existe en el backend
 * desde el día uno y nadie lo escribe; el día que aparezca el material en proceso, la pantalla
 * suma una etiqueta y no una migración.
 */
export const ASSEMBLY_STATUSES = ['DONE', 'CANCELLED'] as const;

export type AssemblyStatus = (typeof ASSEMBLY_STATUSES)[number];

/** Una fila del listado de armados (wireframe `1t`). */
export interface AssemblyRow {
  uuid: string;
  publicId: string | null;
  assemblyStatus: string;
  dateCreated: string;
  product: UuidNameRef | null;
  warehouse: UuidNameRef | null;
  branch: UuidNameRef | null;
  quantity: number | null;
  batchNumber: string | null;
  /**
   * Uuid de la partida producida. Es lo que abre la trazabilidad: la consulta va **por lote** y no
   * por armado, así que con el uuid del armado la pantalla responde «el lote no existe».
   */
  batchUuid: string | null;
  expirationDate: string | null;
  extraCost: number | null;
  totalCost: number | null;
  /** El costo unitario resultante: la columna que hace visible si un armado salió caro. */
  unitCost: number | null;
  createdByUser: UuidNameRef | null;
  cancelledByUser: UuidNameRef | null;
  dateCancelled: string | null;
}

/** Una línea consumida, ya resuelta: de qué lote salió, cuánto y a qué costo. */
export interface AssemblyItem {
  uuid?: string | null;
  component: UuidNameRef;
  componentSku: string | null;
  quantity: number | null;
  unitCost: number | null;
  lineCost: number | null;
  costShare: number | null;
  batchNumber: string | null;
  expirationDate: string | null;
}

/** El documento completo, tal como lo devuelve el alta y la cancelación. */
export interface AssemblyDetail extends AssemblyRow {
  productSku: string | null;
  productStockTracking: string | null;
  observations: string | null;
  items: AssemblyItem[];
}

/** Cuánto sale de cada lote. Viene resuelto por la política y se edita con `stock.batch_select`. */
export interface AssemblyAllocation {
  batchUuid: string;
  batchNumber: string | null;
  expirationDate: string | null;
  quantity: number;
  unitCost: number | null;
}

/** Un lote con saldo del componente, para poder repartir a mano. */
export interface AssemblySourceBatch {
  uuid: string;
  batchNumber: string | null;
  expirationDate: string | null;
  availableQuantity: number | null;
  unitCost: number | null;
}

/** Una fila de «qué se consume» del precálculo. */
export interface AssemblyPreviewComponent {
  component: UuidNameRef;
  componentSku: string | null;
  componentStockTracking: string | null;
  /** Cuánto entra en **una** unidad del terminado, según la composición. */
  quantityPerUnit: number | null;
  /** Cuánto se consume en total, o lo que ajustó el operador para este armado. */
  quantity: number | null;
  availableQuantity: number | null;
  /** Cuántas unidades del terminado cubre este componente él solo. */
  coverage: number | null;
  /** `true` si es el que impone el máximo: es la fila que «manda». */
  limiting: boolean | null;
  shortage: boolean | null;
  allocations: AssemblyAllocation[];
  availableBatches: AssemblySourceBatch[];
  cost: number | null;
  expirationDate: string | null;
}

/**
 * El precálculo del armado (`POST /assembly/preview`), que es lo que la pantalla muestra en vivo.
 *
 * **Existe por una razón concreta:** un costo unitario mal calculado no rompe nada —el armado se
 * registra, la venta sale, el saldo cuadra— y se descubre meses después, en un margen que ya no se
 * puede reconstruir porque el costo quedó congelado (RN-24). La única defensa es que el operador vea
 * el número antes de confirmar, con el desglose que lo hace rehacible a mano.
 */
export interface AssemblyPreview {
  product: UuidNameRef;
  productStockTracking: string | null;
  quantity: number | null;
  /** Cuántas unidades enteras alcanza a cubrir el stock de hoy. */
  maxProducible: number | null;
  /** Quién impone ese máximo. Sin esto, el número de arriba no se puede rehacer de un vistazo. */
  limitingComponent: UuidNameRef | null;
  shortage: boolean | null;
  components: AssemblyPreviewComponent[];
  componentsCost: number | null;
  extraCost: number | null;
  totalCost: number | null;
  unitCost: number | null;
  /** El mínimo de los componentes: una sugerencia **y un techo** (RN-25). */
  suggestedExpirationDate: string | null;
  /** Quién impone ese vencimiento. La pantalla lo nombra: «vence primero el jamón cocido». */
  expirationDrivenBy: UuidNameRef | null;
}

/** Lo que se manda al precalcular y al registrar. */
export interface AssemblyPayload {
  product: { uuid: string };
  warehouse: { uuid: string };
  quantity: number;
  extraCost?: number | null;
  batchNumber?: string | null;
  expirationDate?: string | null;
  serials?: string[] | null;
  observations?: string | null;
  components?: AssemblyComponentPayload[] | null;
}

/**
 * Un componente con la cantidad que el operador ajustó para **este** armado y, opcionalmente, el
 * reparto manual por lote.
 *
 * Ajustar acá **no toca la composición** del producto (P10): «hoy usé más queso» y «de ahora en más
 * lleva más queso» son dos decisiones distintas, y la segunda se toma en la ficha.
 */
export interface AssemblyComponentPayload {
  component: { uuid: string };
  quantity: number;
  allocations?: { batchUuid: string; quantity: number }[] | null;
}

/** Lo que se manda y lo que vuelve al desarmar. */
export interface DisassemblyPayload {
  product: { uuid: string };
  warehouse: { uuid: string };
  quantity: number;
  observations?: string | null;
}

export interface DisassemblyResult {
  quantity: number | null;
  unitCost: number | null;
  /** Coincide con `unitCost × quantity`: el desarme no pierde valor (RN-26). */
  returnedCost: number | null;
  returnedComponents: AssemblyItem[];
}

// ═══════════════════════════════════════════════════════════════════════
// Trazabilidad
// ═══════════════════════════════════════════════════════════════════════

/** Un armado que consumió la partida buscada. */
export interface AssemblyTraceAssembly {
  uuid: string;
  publicId: string | null;
  dateCreated: string;
  assemblyStatus: string;
  product: UuidNameRef | null;
  quantity: number | null;
  consumedQuantity: number | null;
  batchNumber: string | null;
  batchUuid: string | null;
  expirationDate: string | null;
  warehouse: UuidNameRef | null;
}

/** Una venta de las unidades terminadas: el final de la cadena. */
export interface AssemblyTraceSale {
  orderUuid: string;
  publicId: string | null;
  dateOperation: string | null;
  party: UuidNameRef | null;
  quantity: number | null;
  branch: UuidNameRef | null;
  batchNumber: string | null;
}

/**
 * La pantalla del recall (wireframe `1u`), en tres pasos: dónde se usó el lote del componente, en
 * qué estado quedaron esas unidades y a quién se le vendieron.
 *
 * Es lo que el kit virtual no puede contestar: en modo virtual el conjunto nunca existió como unidad
 * y no hay nada entre el componente y el cliente.
 */
export interface AssemblyTrace {
  batch: UuidNameRef | null;
  batchNumber: string | null;
  product: UuidNameRef | null;
  assemblies: AssemblyTraceAssembly[];
  producedQuantity: number | null;
  soldQuantity: number | null;
  inStockQuantity: number | null;
  otherQuantity: number | null;
  sales: AssemblyTraceSale[];
  customerCount: number | null;
}

/** El camino inverso: del terminado hasta los lotes que lo formaron. */
export interface AssemblyBackTrace {
  batch: UuidNameRef | null;
  batchNumber: string | null;
  product: UuidNameRef | null;
  expirationDate: string | null;
  assemblyUuid: string | null;
  assemblyPublicId: string | null;
  assemblyDate: string | null;
  components: AssemblyItem[];
}

// ═══════════════════════════════════════════════════════════════════════
// Permisos
// ═══════════════════════════════════════════════════════════════════════

export const ASSEMBLY_VIEW_PERMISSION: Permission = Permissions.assemblyView;
export const ASSEMBLY_CREATE_PERMISSION: Permission = Permissions.assemblyCreate;
export const ASSEMBLY_CANCEL_PERMISSION: Permission = Permissions.assemblyCancel;
/**
 * Propio, y no `assembly.cancel`: cancelar revierte **un documento** y sólo si nadie tocó las
 * unidades; desarmar rompe unidades sueltas que pueden venir de armados distintos. Quien puede una
 * cosa no necesariamente puede la otra.
 */
export const ASSEMBLY_DISASSEMBLE_PERMISSION: Permission = Permissions.assemblyDisassemble;

/** Sólo se cancela un armado hecho: uno cancelado no tiene nada que revertir. */
export function isCancellable(row: AssemblyRow): boolean {
  return row.assemblyStatus === 'DONE';
}
