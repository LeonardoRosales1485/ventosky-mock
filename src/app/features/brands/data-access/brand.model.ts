import { Versioned } from '../../../core/concurrency/version-conflict.model';

/** Payload / response shape for `BrandDTO` from the backend. */
export interface BrandDto extends Versioned {
  uuid: string;
  name: string;
}

export interface BrandSavePayload {
  uuid?: string;
  name: string;
  /** Versión leída al abrir el formulario. Sin ella el backend rechaza toda edición con 409. */
  version?: number;
}
