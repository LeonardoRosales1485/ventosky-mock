/**
 * Una línea del archivo de saldos iniciales: **una partida completa**, no el renglón de un total.
 *
 * Por qué no alcanza con «Juan debe 340.000»: el vencido, la morosidad, el aviso de deuda y el corte
 * por límite se calculan los cuatro sobre el vencimiento. Un importe único de apertura los deja a los
 * cuatro contestando que no hay nada vencido durante todo el primer año — que es justo el año en que
 * la deuda vieja es la que importa.
 */
export interface OpeningLineRequest {
  /** El titular por uuid de rol. Alternativa: `partyDocument` + `role`. */
  partyRoleUuid?: string;
  /** El documento, para los archivos del sistema viejo que no conocen uuids de éste. */
  partyDocument?: string;
  /** `CUSTOMER` o `SUPPLIER`. Sólo se usa junto con `partyDocument`. */
  role?: string;
  /** `DEBT` (lo que ya debía) o `CREDIT` (lo que ya tenía a favor). */
  type: string;
  /** El comprobante original: es lo que hace reconocible la partida cuando el titular llama. */
  publicId: string;
  amount: number;
  /** `yyyy-MM-ddTHH:mm:ss.SSS`. */
  dateIssued: string;
  /** `yyyy-MM-dd`. Obligatorio en las deudas, prohibido en los saldos a favor. */
  dateDue?: string;
  description?: string;
}

/** El cuerpo de la previa y de la carga: el lote entero, en un solo viaje. */
export interface OpeningBalanceRequest {
  sourceName?: string;
  lines: readonly OpeningLineRequest[];
}

/** Qué va a pasar con una línea, dicho antes de escribir nada. */
export interface OpeningPreviewLineDto {
  /** El índice en el archivo, arrancando en 1: es cómo se ubica la fila que hay que corregir. */
  line: number;
  /** `NUEVA | REPETIDA | ERROR`. */
  state: string;
  /** Por qué no se puede cargar, cuando el estado es `ERROR`. */
  message: string | null;
  partyRoleUuid: string | null;
  /** El nombre resuelto: quien aprueba la carga tiene que poder leerla. */
  partyName: string | null;
  role: string | null;
  /** Nulo si la cuenta todavía no existe — la carga la abre. */
  accountUuid: string | null;
  type: string;
  publicId: string;
  amount: number;
  dateDue: string | null;
  /** `true` si la deuda ya nace vencida. */
  overdue: boolean;
}

/**
 * La respuesta de la previa.
 *
 * **No es un lujo de UX.** El saldo inicial es el único dato del módulo que después no se compara
 * contra nada: si entra mal, entra mal para siempre. Ésta es la única oportunidad de revisarlo.
 */
export interface OpeningPreviewDto {
  canImport: boolean;
  /** Este mismo contenido ya se cargó. No impide ejecutar: la carga saltea y no duplica. */
  alreadyImported: boolean;
  alreadyImportedAt: string | null;
  lineCount: number;
  newCount: number;
  duplicateCount: number;
  errorCount: number;
  accountCount: number;
  totalDebt: number;
  totalCredit: number;
  /** Cuánto de lo que se va a cargar nace ya vencido. Es el número que sorprende. */
  totalOverdue: number;
  lines: readonly OpeningPreviewLineDto[];
}

/**
 * Una carga ya hecha, tal como la devuelve el paginado del historial.
 *
 * El **hash** es lo que avisa en la previa que este mismo contenido ya se cargó — la única capa que
 * llega a tiempo para que una persona cancele.
 */
export interface OpeningImportRowDto extends OpeningImportDto {
  dateCreated: string;
}

/** Lo que la carga hizo. `skipped` no es un error: es cargar dos veces sin duplicar. */
export interface OpeningImportDto {
  uuid: string;
  sourceName: string | null;
  contentHash: string;
  lineCount: number;
  createdCount: number;
  skippedCount: number;
  accountCount: number;
  totalDebt: number;
  totalCredit: number;
}
