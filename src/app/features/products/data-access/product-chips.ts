import { ProductChip, ProductChipId } from '../../../shared/components/product-chip/product-chip';
import {
  ProductPaginateDto,
  isAssembledKit,
  isDiscontinued,
  toExpirationControl,
  toKitMode,
  toProductType,
  toStockTracking,
} from './product.model';

/**
 * Los chips de la columna Producto del catálogo (wireframe `1a`, §5.6).
 *
 * El chip es **lo único** que la columna Producto agrega por los ejes: el resto de la tabla no
 * cambia. Por eso sólo aparece cuando el eje se aparta del default —`SIMPLE` + `QUANTITY` + `NONE`,
 * el producto de siempre (RN-21)—: un catálogo entero de productos simples se ve exactamente como
 * antes, y el chip queda reservado para la fila que realmente se comporta distinto.
 *
 * La **forma** del chip y su dibujo viven en `shared/components/product-chip`: acá está sólo la
 * regla de qué producto del catálogo merece cuál. El histórico de compras y ventas tiene la suya,
 * distinta, y las dos pintan con la misma pieza.
 */
export function productChipsOf(product: ProductPaginateDto): ProductChip[] {
  const chips: ProductChip[] = [];

  // Va primero porque cambia cómo se lee todo lo demás: un discontinuado no se ofrece en ninguna
  // operación, así que su eje y su saldo son historia, no oferta. Es además el único chip que
  // describe una **decisión** y no una propiedad —se apagó a mano y se vuelve a prender igual—, y el
  // único que aparece sólo cuando el listado se filtra para verlo (ADR 0001).
  if (isDiscontinued(product)) {
    chips.push({ id: 'discontinued', labelKey: 'products.chips.discontinued' });
  }

  const type = toProductType(product.type);
  if (type === 'KIT') {
    // Los dos modos son dos productos distintos y el chip es lo que los distingue, porque es lo que
    // le da sentido a la columna Stock de la misma fila: el **virtual** no tiene saldo —su
    // disponible se deriva de los componentes (RN-07)— y el **armado** sí, porque existe en el
    // estante y se vende sin explotar (RN-22). Decirle «kit virtual» a un armado con existencias
    // contradice la columna de al lado.
    const assembled = isAssembledKit(type, toKitMode(product.kitMode));
    const id: ProductChipId = assembled ? 'kitAssembled' : 'kit';
    const count = product.kitItemsCount;
    // Las cuatro claves van escritas enteras y no interpoladas desde `id`: así se siguen
    // encontrando con un grep, que es como se audita que no le falte ninguna al `es.json`.
    chips.push(
      count == null
        ? { id, labelKey: assembled ? 'products.chips.kitAssembled' : 'products.chips.kit' }
        : {
            id,
            labelKey: assembled
              ? 'products.chips.kitAssembledWithCount'
              : 'products.chips.kitWithCount',
            params: { count },
          },
    );
  } else if (type === 'SERVICE') {
    chips.push({ id: 'service', labelKey: 'products.chips.service' });
  }

  // El pesable se vende por peso: es la fila cuyo saldo lleva decimales (RN-18).
  if (product.isWeighable) {
    chips.push({ id: 'weighable', labelKey: 'products.chips.weighable' });
  }

  const tracking = toStockTracking(product.stockTracking);
  if (tracking === 'BATCH') {
    chips.push({ id: 'batch', labelKey: 'products.chips.batch' });
  } else if (tracking === 'SERIAL') {
    chips.push({ id: 'serial', labelKey: 'products.chips.serial' });
  }

  // «Vence» es una propiedad del ingreso, no del saldo: da lo mismo si es obligatorio u opcional,
  // lo que la fila tiene que decir es que a este producto se le pide una fecha.
  if (toExpirationControl(product.expirationControl) !== 'NONE') {
    chips.push({ id: 'expires', labelKey: 'products.chips.expires' });
  }

  return chips;
}
