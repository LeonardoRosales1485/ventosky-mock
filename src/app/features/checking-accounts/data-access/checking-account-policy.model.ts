/**
 * La política de cuenta corriente **tal como la devuelve el backend**.
 *
 * Vive en su propio archivo y no en `checking-account.model.ts` a propósito: ese modelo describe el
 * almacén en memoria del prototipo, con una `ResolvedPolicy` que todavía arrastra parámetros que el
 * análisis descartó —umbrales de morosidad, cantidad máxima de comprobantes, la excepción con
 * vencimiento—. Mezclarlos haría que la pantalla nueva ofreciera campos que no existen.
 *
 * Acá están los tres que sí existen, y nada más.
 */

/** Tres respuestas posibles por parámetro, no dos. Un campo nulo no las distingue. */
export type PolicyMode = 'INHERIT' | 'VALUE' | 'UNLIMITED' | 'AMOUNT';

export type PolicyAllocationMode = 'INHERIT' | 'AUTOMATIC' | 'MANUAL';

/** De qué peldaño de la escalera salió el valor que rige. */
export type PolicyValueSource = 'DEFAULT' | 'COMPANY' | 'ACCOUNT';

/**
 * Lo que efectivamente rige, con la fuente de cada valor.
 *
 * **La fuente no es decoración.** Sin ella la pantalla muestra un «30» suelto y quien configura no
 * sabe si mira una decisión propia o una herencia — que es exactamente lo que hay que ver antes de
 * cambiar algo.
 */
export interface ResolvedPolicyDto {
  dueDays: number;
  dueDaysSource: PolicyValueSource;
  /** Nulo = sin tope. Para saber si eso lo decidió alguien está {@link debtLimitSource}. */
  debtLimit: number | null;
  debtLimitSource: PolicyValueSource;
  allocationMode: 'AUTOMATIC' | 'MANUAL';
  allocationModeSource: PolicyValueSource;
}

/** El resumen del reproceso: qué va a pasar, o qué pasó. */
export interface PolicyReprocessDto {
  accounts: number;
  allocations: number;
  settledAmount: number;
  /** Cuentas evaluadas. «3 de 400» y «3 de 3» son resultados distintos. */
  evaluatedAccounts: number;
  /** Vacío no es lo mismo que ausente: una transacción por cuenta puede fallar sola. */
  failedAccounts: string[];
}

export interface CheckingAccountPolicyDto {
  uuid: string | null;
  version: number;
  /** Ausente en la política de la empresa; con valor, es el override de un titular. */
  accountUuid: string | null;
  dueDaysMode: PolicyMode;
  dueDays: number | null;
  debtLimitMode: PolicyMode;
  debtLimitAmount: number | null;
  allocationMode: PolicyAllocationMode;
  resolved: ResolvedPolicyDto;
  /** Sólo cuando este guardado pasó la empresa de `MANUAL` a `AUTOMATIC`. */
  reprocess: PolicyReprocessDto | null;
}

/** Lo que se manda a guardar. Sin `uuid`: la política se identifica por su nivel. */
export interface SaveCompanyPolicyRequest {
  dueDaysMode: 'VALUE';
  dueDays: number;
  debtLimitMode: 'UNLIMITED' | 'AMOUNT';
  debtLimitAmount: number | null;
  allocationMode: 'AUTOMATIC' | 'MANUAL';
}

/**
 * Qué pasaría si se guardara esa política, antes de guardarla.
 *
 * Las dos respuestas vienen juntas porque el administrador toma **una** decisión: guardar o no.
 */
export interface PolicyPreviewDto {
  /** Nulo si el guardado no sería una transición a automático — distinto de «no imputaría nada». */
  reprocess: PolicyReprocessDto | null;
  /**
   * Cuántas cuentas quedarían con el saldo por encima del límite propuesto.
   *
   * **No bloquea nada**: el límite gobierna operaciones nuevas y no reescribe el pasado. Pero quien
   * lo baja tiene que enterarse antes de guardar, no después.
   */
  accountsOverLimit: number;
  debtLimit: number | null;
}

/**
 * Lo que se manda para guardar el override de un titular.
 *
 * A diferencia de la política de la empresa, acá `INHERIT` **sí** es una opción por parámetro —y es
 * el modo de sacarlo: la fila queda pero deja de decidir, y ese parámetro vuelve a lo que diga la
 * empresa.
 */
export interface SaveAccountPolicyRequest {
  dueDaysMode: 'INHERIT' | 'VALUE';
  dueDays: number | null;
  debtLimitMode: 'INHERIT' | 'UNLIMITED' | 'AMOUNT';
  debtLimitAmount: number | null;
  allocationMode: PolicyAllocationMode;
}

/** Los cuatro niveles de morosidad. Vocabulario compartido: ninguno tiene efecto. */
export type DelinquencyLevelValue = 'AL_DIA' | 'EN_MORA' | 'MOROSO' | 'MOROSO_GRAVE';

/** Un cambio de nivel, tal como lo devuelve el historial. */
export interface DelinquencyEventDto {
  uuid: string;
  accountUuid: string;
  level: DelinquencyLevelValue;
  /** De dónde venía. Se guarda y no se infiere: la fila tiene que explicarse sola. */
  previousLevel: DelinquencyLevelValue;
  reason: string;
  dateDecided: string;
}

/** Fijar el nivel. El motivo es obligatorio, y `previousLevel` no viaja: lo resuelve el backend. */
export interface SetDelinquencyRequest {
  level: DelinquencyLevelValue;
  reason: string;
}
