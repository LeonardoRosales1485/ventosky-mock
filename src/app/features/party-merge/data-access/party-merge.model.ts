/**
 * Un tercero visto desde la fusión: quién es y **cuánta historia tiene**.
 *
 * Los tres números —roles, operaciones y saldo— son los que permiten decidir cuál de los dos
 * duplicados conviene que sobreviva. Sin ellos, elegir es tirar una moneda: la fusión es
 * irreversible en la práctica, y el que sobrevive se queda con el uuid que el resto del sistema ya
 * conoce.
 */
export interface PartyMergeSideDto {
  uuid: string;
  name: string;
  docType: string | null;
  docNumber: string | null;
  /** `CUSTOMER`, `SUPPLIER`. */
  roles: readonly string[];
  orders: number;
  entries: number;
  balance: number;
  /** Desde cuándo existe: suele ser lo que decide cuál de los dos es «el bueno». */
  dateCreated: string;
}

/**
 * Todo lo que la fusión va a mover, antes de moverlo.
 *
 * La pantalla lo muestra completo antes de confirmar porque después no hay vuelta: no existe una
 * operación que deshaga una fusión.
 */
export interface PartyMergePreviewDto {
  survivor: PartyMergeSideDto;
  absorbed: PartyMergeSideDto;
  /** Roles que el superviviente no tiene: se repuntan enteros, con su cuenta colgando. */
  rolesToMove: readonly string[];
  /** Roles que ya tiene: ahí se mueve el contenido y el rol del absorbido se apaga. */
  rolesToMerge: readonly string[];
  ordersToMove: number;
  entriesToMove: number;
  contactsToMove: number;
  /** La suma exacta de los dos saldos: las partidas se mueven, no se recalculan. */
  resultingBalance: number;
}

/** El cuerpo de la previa y de la ejecución. El motivo sólo se manda al confirmar. */
export interface PartyMergeRequest {
  survivorUuid: string;
  absorbedUuid: string;
  reason?: string;
}

/** Una fusión ya hecha. */
export interface PartyMergeDto {
  uuid: string;
  survivorUuid: string;
  survivorName: string;
  absorbedUuid: string;
  absorbedName: string;
  reason: string;
  movedRoles: number;
  mergedRoles: number;
  movedOrders: number;
  movedEntries: number;
  movedBalance: number;
  dateMerged: string;
}
