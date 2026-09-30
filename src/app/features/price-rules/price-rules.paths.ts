export const PRICE_RULES_PATHS = '/panel/price-rules';

/** Alta de regla de precio. */
export const PRICE_RULES_NEW_PATH = `${PRICE_RULES_PATHS}/new`;

/** Edición de una regla existente; la pantalla es la misma que la del alta. */
export function priceRuleEditPath(uuid: string): string {
  return `${PRICE_RULES_PATHS}/${uuid}/edit`;
}
