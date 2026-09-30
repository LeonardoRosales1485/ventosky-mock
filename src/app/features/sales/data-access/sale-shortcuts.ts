/**
 * Las teclas con las que se maneja el punto de venta.
 *
 * Están todas juntas y en un solo lugar porque las leen tres cosas distintas que **tienen** que
 * coincidir: el manejador de teclado de la pantalla, la leyenda del pie y el `kbd` que cada acción
 * lleva escrito encima. Una tecla que la leyenda promete y la pantalla no atiende es peor que no
 * tener el atajo.
 *
 * Son teclas sueltas y no combinaciones: en un mostrador se aprietan con la mano que queda libre
 * mientras la otra sostiene el lector.
 */
export const SALE_SHORTCUTS = {
  /** Abre el selector de clientes. */
  customer: 'F4',
  /** Pide la cantidad de la línea marcada. */
  quantity: 'F5',
  /** Abre la lista de precios de la línea marcada. */
  priceList: 'F6',
  /** Abre el selector de lote de la línea marcada. */
  batch: 'F7',
  /** Abre el selector de series de la línea marcada. */
  serials: 'F8',
  /**
   * Abre el cobro. `F9` y no la `F12` de los POS de escritorio porque el navegador se queda con esa
   * para las herramientas de desarrollo y la pantalla nunca llega a verla.
   */
  charge: 'F9',
} as const;

/**
 * Las teclas que se escriben distinto de como las nombra `KeyboardEvent.key`.
 *
 * `Supr` es como está serigrafiado el `Delete` en un teclado en español, y es lo que el cajero
 * busca con el dedo; `↑ ↓` y `Esc` son la forma corta de lo mismo. La leyenda dice lo que está
 * escrito en la tecla, no lo que dice el DOM.
 */
export const SALE_KEY_LABELS = {
  remove: 'Supr',
  select: '↑ ↓',
  back: 'Esc',
} as const;

/** Una entrada de la leyenda: la tecla tal como se lee y qué hace, en clave de traducción. */
export interface SaleShortcutHint {
  key: string;
  labelKey: string;
}

/**
 * La leyenda del pie, en el orden en que se recorre la operación: primero cómo entra la mercadería,
 * después qué se le hace a una línea, y al final cerrar.
 *
 * Es parte del diseño y no un apéndice: es lo único que convierte a un cajero nuevo en uno que no
 * toca el mouse, y ocupa una franja de alto que en una pantalla de mostrador se paga sola.
 */
export const SALE_SHORTCUT_HINTS: readonly SaleShortcutHint[] = [
  { key: SALE_SHORTCUTS.customer, labelKey: 'sales.keys.customer' },
  { key: SALE_SHORTCUTS.quantity, labelKey: 'sales.keys.quantity' },
  { key: SALE_SHORTCUTS.priceList, labelKey: 'sales.keys.priceList' },
  { key: SALE_SHORTCUTS.batch, labelKey: 'sales.keys.batch' },
  { key: SALE_SHORTCUTS.serials, labelKey: 'sales.keys.serials' },
  { key: SALE_SHORTCUTS.charge, labelKey: 'sales.keys.charge' },
  { key: SALE_KEY_LABELS.select, labelKey: 'sales.keys.select' },
  { key: SALE_KEY_LABELS.remove, labelKey: 'sales.keys.remove' },
  { key: SALE_KEY_LABELS.back, labelKey: 'sales.keys.back' },
];
