import { UuidNameRef } from '../http/api-refs';

/**
 * Cliente tal como lo devuelve `POST /party/customer/paginate`: el rol `CUSTOMER` del maestro
 * unificado, con su identidad embebida.
 *
 * Es el DTO crudo y no un modelo propio: quien abre el selector recibe la fila entera —con la lista
 * preferida, que es la que después resuelve los precios— y no tiene que volver a pedirla.
 */
export interface PickerCustomer {
  uuid: string;
  name: string;
  docType?: string | null;
  docNumber?: string | null;
  /** Lista preferida del cliente: es la que después resuelve los precios de la venta. */
  priceList?: UuidNameRef | null;
}

/** Opciones con las que se abre el selector. */
export interface CustomerPickerOptions {
  /** Con qué texto abre el buscador; sirve para continuar lo que ya se había tipeado afuera. */
  initialSearch?: string;
  /** Quién está elegido hoy. Se marca en la lista para que se vea a quién se le está por cambiar. */
  selectedUuid?: string | null;
  /** Título del diálogo; por defecto el genérico del selector. */
  title?: string;
}

/** Lo que recibe el diálogo. Es el mismo contrato que {@link CustomerPickerOptions}. */
export type CustomerPickerDialogData = CustomerPickerOptions;
