import { ProductPaginateDto } from './product.model';

/**
 * Una línea del diálogo que pide confirmar el archivado, como clave i18n más sus interpolaciones.
 *
 * Devuelve claves y no texto para que la decisión de **qué decir** se pueda probar sin montar el
 * servicio de traducción: lo que hay que verificar acá es cuándo aparece cada consecuencia, no cómo
 * está redactada.
 */
export interface ArchiveConsequence {
  labelKey: string;
  params?: Record<string, string | number>;
}

/**
 * Qué le va a pasar al producto si se archiva, en el orden en que conviene leerlo.
 *
 * El listado es la **única** pantalla donde el usuario ve la regla de los códigos, y archivar no se
 * deshace (ADR 0001): un diálogo que sólo repite el nombre del producto le pide confirmar algo que
 * no puede evaluar. Así que dice las tres cosas que cambian y que no están en ninguna columna:
 *
 * 1. que no hay vuelta atrás — revivir un registro eliminado está prohibido en el Core;
 * 2. cuántas unidades quedan sin poder venderse — es el dato que más veces hace cancelar;
 * 3. si el código vuelve al pool — pasa sólo con el producto que nunca se movió.
 *
 * **Cada línea aparece sólo cuando dice algo.** Sin saldo no se habla de stock, y sin
 * {@link ProductPaginateDto.hasMovements} no se habla del código: un backend anterior a `6.10.0` no
 * informa la historia, y ausente es «no sé», no «nunca se movió». Prometer un código que después no
 * se libera es peor que no mencionarlo.
 */
export function archiveConsequencesOf(product: ProductPaginateDto): ArchiveConsequence[] {
  const lines: ArchiveConsequence[] = [{ labelKey: 'products.archive.irreversible' }];

  // `tracksStock === false` es el servicio y el kit virtual: su saldo es `null` por definición
  // (RN-01) y no hay unidades que se pierdan. Con saldo cero tampoco hay nada que advertir.
  const stock = product.totalStock ?? 0;
  if (product.tracksStock !== false && stock > 0) {
    lines.push({ labelKey: 'products.archive.stockLost', params: { count: stock } });
  }

  // El SKU es el código que la grilla muestra; el de barras queda como alternativa para el producto
  // que no lo usa. El de balanza no viaja en el paginado, así que no se nombra.
  const code = product.sku || product.barcode;
  if (product.hasMovements === false && code) {
    lines.push({ labelKey: 'products.archive.codeReleased', params: { code } });
  }

  return lines;
}
