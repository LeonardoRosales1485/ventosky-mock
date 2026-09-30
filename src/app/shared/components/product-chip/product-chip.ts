/**
 * Los chips con los que el sistema describe a un producto, en cualquier pantalla que lo nombre.
 *
 * Viven en `shared/` y no en el catálogo porque son **vocabulario visual**, no una regla: quién
 * merece qué chip lo decide cada dominio —el catálogo con {@code productChipsOf}, el histórico de
 * compras y ventas con {@code productCatalogStateChip}—, pero «discontinuado» tiene que verse igual
 * en la grilla de productos y en la línea de una venta de hace seis meses. Tenerlo escrito dos veces
 * era la forma de que empezaran a divergir.
 */
export interface ProductChip {
  /** Identifica al chip y da el modificador de estilo (`chip--batch`). */
  id: ProductChipId;
  /** Clave de traducción de la etiqueta. */
  labelKey: string;
  /** Interpolaciones de la etiqueta, cuando el chip dice también un número. */
  params?: Record<string, number>;
}

/**
 * Los dos primeros son **estados del catálogo** —decisiones que alguien tomó sobre el producto— y el
 * resto son propiedades de lo que el producto es o de cómo se cuenta. La distinción importa para el
 * color: los estados se pintan, las propiedades van con el chip neutro de siempre.
 */
export type ProductChipId =
  | 'archived'
  | 'discontinued'
  | 'kit'
  | 'kitAssembled'
  | 'service'
  | 'weighable'
  | 'batch'
  | 'serial'
  | 'expires';
