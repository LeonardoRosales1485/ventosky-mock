export const PROMOTIONS_PATHS = '/panel/promotions';

/** Alta de promoción. */
export const PROMOTIONS_NEW_PATH = `${PROMOTIONS_PATHS}/new`;

/** Edición de una promoción existente; la pantalla es la misma que la del alta. */
export function promotionEditPath(uuid: string): string {
  return `${PROMOTIONS_PATHS}/${uuid}/edit`;
}
