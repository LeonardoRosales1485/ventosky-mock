/**
 * Formas de referencia que devuelve la API cuando sólo nombra una entidad en vez de traerla entera.
 *
 * Vive en `core/http/` y no en un feature porque no pertenece a ninguno: es el contrato de los DTO
 * del backend (`UuidNameDTO`), y lo consumen por igual las órdenes, las cajas y las pantallas que
 * listan relaciones.
 */

/** `UuidNameDTO`: la referencia mínima con la que viaja todo lo que sólo se nombra. */
export interface UuidNameRef {
  uuid: string;
  name: string;
}
