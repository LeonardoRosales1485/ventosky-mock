import { describe, expect, it } from 'vitest';
import {
  SERIALS_INLINE_LIMIT,
  StockTransferLine,
  anyLineHasBatch,
  anyLineHasExpiration,
  serialsFitInline,
  serialsNeedDialog,
  unitAbbrevKey,
} from './stock-transfer.model';

function line(extra: Partial<StockTransferLine> = {}): StockTransferLine {
  return { uuid: 'l-1', quantity: 1, ...extra };
}

/**
 * La tabla del detalle tiene que servir para los cuatro ejes y no sólo para el que lleva partidas.
 * Estas dos preguntas son las que deciden si «Lote» y «Vencimiento» valen una columna: en un
 * traslado de notebooks o de mercadería suelta son guiones que empujan la cantidad y el costo fuera
 * de la vista.
 */
describe('Columnas de partida del traslado', () => {
  it('no dibuja «Lote» en un traslado sin partidas', () => {
    // El backend ya no manda el lote `UNICO`: en un producto que no las maneja, viene nulo.
    expect(anyLineHasBatch([line(), line({ batchNumber: null })])).toBe(false);
  });

  it('la dibuja si aunque sea una línea trae partida', () => {
    expect(anyLineHasBatch([line(), line({ batchNumber: 'L-0927' })])).toBe(true);
  });

  /** Una partida puede llevar número y no vencer: son dos columnas y dos preguntas distintas. */
  it('separa vencimiento de número de lote', () => {
    const lines = [line({ batchNumber: 'L-0927' })];

    expect(anyLineHasBatch(lines)).toBe(true);
    expect(anyLineHasExpiration(lines)).toBe(false);
  });

  it('un traslado sin líneas no dibuja ninguna de las dos', () => {
    expect(anyLineHasBatch(null)).toBe(false);
    expect(anyLineHasExpiration(undefined)).toBe(false);
  });
});

/**
 * La cantidad sola no dice de qué: «2,5» de un fiambre son kilos y de una notebook sería un error.
 */
describe('Unidad de la línea', () => {
  it('resuelve la clave de la abreviatura', () => {
    expect(unitAbbrevKey(line({ unitMeasure: 'KILOGRAM' }))).toBe('products.unitAbbrev.KILOGRAM');
  });

  /**
   * Un producto que no declara unidad no recibe una inventada: escribir «u.» al lado de lo que
   * puede ser un peso es peor que no escribir nada.
   */
  it('no le inventa unidad al producto que no la declara', () => {
    expect(unitAbbrevKey(line())).toBeNull();
    expect(unitAbbrevKey(line({ unitMeasure: null }))).toBeNull();
  });
});

/**
 * Las series se leen sueltas cuando son pocas y se resumen cuando son muchas: dos o tres equipos se
 * responden sin un clic, cuarenta convierten la fila en un muro.
 */
describe('Series en la fila del detalle', () => {
  function withSerials(count: number): StockTransferLine {
    return line({ serials: Array.from({ length: count }, (_, i) => `SN-${i}`) });
  }

  it('una línea sin series no muestra ni chips ni botón', () => {
    expect(serialsFitInline(line())).toBe(false);
    expect(serialsNeedDialog(line())).toBe(false);
    expect(serialsFitInline(line({ serials: [] }))).toBe(false);
  });

  it('pocas unidades se leen en la fila', () => {
    expect(serialsFitInline(withSerials(3))).toBe(true);
    expect(serialsNeedDialog(withSerials(3))).toBe(false);
  });

  /** El límite entra; el que lo pasa, no. Es la frontera y es donde se rompen estas reglas. */
  it('el límite entra y el siguiente ya no', () => {
    expect(serialsFitInline(withSerials(SERIALS_INLINE_LIMIT))).toBe(true);
    expect(serialsNeedDialog(withSerials(SERIALS_INLINE_LIMIT))).toBe(false);

    expect(serialsFitInline(withSerials(SERIALS_INLINE_LIMIT + 1))).toBe(false);
    expect(serialsNeedDialog(withSerials(SERIALS_INLINE_LIMIT + 1))).toBe(true);
  });

  /** Nunca las dos: o se ven en la fila, o se ven en el diálogo. */
  it('las dos formas son excluyentes', () => {
    [0, 1, 5, 6, 40].forEach((count) => {
      const target = withSerials(count);
      expect(serialsFitInline(target) && serialsNeedDialog(target)).toBe(false);
    });
  });
});
