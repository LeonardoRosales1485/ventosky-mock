import { HttpErrorResponse } from '@angular/common/http';
import { readApiErrorData } from '../http/api-error.model';

/**
 * Lo que el mostrador necesita saber de la cuenta corriente de un titular, **ya decidido por el
 * backend**.
 *
 * Vive en `core/` y no en el feature de cuentas corrientes porque lo consumen dos pantallas que no
 * se conocen entre sí —el punto de venta y la nueva compra—, y un feature no importa de otro.
 *
 * §10.1 — **el front no recalcula nada de esto.** Sin este contrato la pantalla juntaría saldo,
 * límite, política y estado de la cuenta de tres endpoints y replicaría las reglas del portón; el
 * día que una cambie habría dos versiones de la verdad, y el POS habilitaría lo que el commit
 * rechaza, con el cliente esperando en el mostrador.
 */

/** Los cuatro peldaños de `DelinquencyLevels`. Ninguno bloquea nada: son informativos (§9.2). */
export type DelinquencyLevel = 'AL_DIA' | 'EN_MORA' | 'MOROSO' | 'MOROSO_GRAVE';

/** Qué se está por hacer. Es lo que decide si el límite se mira siquiera. */
export type AccountOperation = 'SALE' | 'PURCHASE';

/**
 * `GET /checking-account/party-role/{uuid}/availability`.
 *
 * Se pregunta por el **rol** y no por la cuenta porque es lo que el mostrador tiene en la mano al
 * elegir el cliente: el uuid de la cuenta corriente no lo conoce, y traducirlo sería un segundo
 * viaje para pintar un cartel que tiene que estar antes de que se cargue el primer artículo.
 */
export interface AccountAvailabilityDto {
  accountUuid: string;
  /** El nombre del titular, para el cartel. */
  partyName?: string | null;
  operation?: AccountOperation | string | null;
  /**
   * **La decisión.** Sin `requestedAmount` contesta si se puede llevar *algo* a cuenta; con él, si
   * se puede llevar *ese* importe.
   */
  allowed?: boolean | null;
  /**
   * El `errorCode` que devolvería el commit cuando `allowed` es `false`. Es el mismo string, para
   * que la pantalla tenga un solo mapa de mensajes y no dos.
   */
  blockedReason?: string | null;
  /** Positivo = el titular debe. */
  balance?: number | null;
  /** Lo que ya venció y sigue sin pagarse. */
  overdueAmount?: number | null;
  /** **Nulo = sin tope**, que es una decisión legítima y el default de plataforma. */
  debtLimit?: number | null;
  /**
   * Cuánto se puede llevar a cuenta ahora mismo. **Nulo cuando no hay tope** — no es «cero
   * disponible», es «no hay nada que consumir», y el diálogo dice cosas distintas.
   *
   * En una compra viaja nulo junto con `debtLimit`: cuánto nos fía un proveedor lo decide el
   * proveedor.
   */
  available?: number | null;
  requestedAmount?: number | null;
  /** Informativo. Ninguno de los cuatro aparece nunca en `blockedReason`. */
  delinquencyLevel?: DelinquencyLevel | string | null;
  /** Kill switch del titular: es lo único que deshabilita el medio de pago. */
  enabled?: boolean | null;
}

/** `ACCOUNT_DISABLED`: la cuenta está apagada, y eso sí deshabilita el medio (§9.2). */
export const ACCOUNT_DISABLED = 'ACCOUNT_DISABLED';

/** `ACCOUNT_DEBT_LIMIT_EXCEEDED`: el único de los cuatro rechazos del portón que se puede forzar. */
export const ACCOUNT_DEBT_LIMIT_EXCEEDED = 'ACCOUNT_DEBT_LIMIT_EXCEEDED';

/**
 * El detalle estructurado del rechazo por límite, tal como el backend lo adjunta en
 * `data.accountDebtLimit`.
 *
 * Viaja con el disponible y no sólo con el rechazo, y eso es el punto: un «no se puede» a secas
 * manda al cajero a llamar por teléfono; con el disponible, el diálogo propone ese importe y deja el
 * resto para otro medio.
 */
export interface AccountDebtLimitDetail {
  accountUuid?: string | null;
  balance?: number | null;
  debtLimit?: number | null;
  /** Lo que se quiso llevar a cuenta. */
  requested?: number | null;
  /** Lo que sí entra ahora mismo. Es el número que el diálogo propone. */
  available?: number | null;
  /** Cuánto se pasa del límite. Es lo que queda estampado en la deuda si alguien autoriza. */
  excess?: number | null;
  /**
   * La marca de forzable. **La pone el backend**: la pantalla no tiene por qué saberse de memoria
   * cuál de los cuatro rechazos del portón admite excepción, y ese conocimiento duplicado es
   * exactamente lo que se desactualiza.
   */
  forcible?: boolean | null;
  /** El permiso que la excepción exige, dicho por quien la valida. */
  overridePermission?: string | null;
}

/** Clave con la que el backend adjunta {@link AccountDebtLimitDetail}. */
const DEBT_LIMIT_DATA_KEY = 'accountDebtLimit';

/**
 * El detalle del rechazo por límite, o `null` si el commit falló por cualquier otra cosa.
 *
 * Es un **400 y no un 409** —a diferencia del faltante de stock— porque el límite no es un conflicto
 * de concurrencia: la operación está mal formada para esta cuenta. Por eso no se filtra por status:
 * lo que decide es que el backend haya adjuntado el detalle.
 *
 * Sólo devuelve algo cuando el propio backend marcó el rechazo como forzable. Un detalle sin esa
 * marca es información para el mensaje, no una invitación a preguntar.
 */
export function readAccountDebtLimit(error: unknown): AccountDebtLimitDetail | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }

  const detail = readApiErrorData(error)?.[DEBT_LIMIT_DATA_KEY] as
    | AccountDebtLimitDetail
    | undefined;

  return detail?.forcible === true ? detail : null;
}
