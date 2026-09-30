import { describe, expect, it } from 'vitest';
import fixtures from './promotion-engine-fixtures.json';
import { round2 } from './decimals';
import {
  PromotionApplication,
  PromotionEvaluationInput,
  evaluatePromotions,
} from './promotion-engine';

/**
 * El motor contra los fixtures compartidos con el backend (ADR-0002).
 *
 * Un caso acá describe **lo que el comercio cobra**, no cómo el motor llegó al número: la entrada
 * es un carrito con promociones y la salida son importes. Si el pipeline se reescribe entero y los
 * totales siguen dando igual, esto sigue en verde.
 *
 * El archivo JSON es una **copia** del que vive en `src/test/resources/promotions/` del backend y
 * corre en las dos suites con los mismos totales esperados. No se edita acá: si falta un caso, se
 * agrega del lado del backend y se re-sincroniza con `scripts/sync-promotion-fixtures.sh` del
 * workspace, que es también quien verifica en CI que las dos copias no hayan divergido.
 *
 * La comparación es **exacta**, no por aproximación: el margen contra el backend es un centavo para
 * todo el carrito, así que un test que tolere centavos no probaría lo que hay que probar.
 */

interface ExpectedLine {
  index: number;
  discountAmount: number;
  net: number;
  taxAmount: number;
  subtotal: number;
}

interface Fixture {
  name: string;
  input: PromotionEvaluationInput;
  expected: {
    lines: ExpectedLine[];
    applications: PromotionApplication[];
    orderDiscount: number;
    total: number;
  };
}

/**
 * El JSON entra sin tipo —es un archivo de datos, no un módulo—, así que la forma se declara acá y
 * el único cast del spec es éste. Si el backend cambia la forma del fixture, lo que rompe es la
 * comparación de cada caso, no el tipado.
 */
const CASES = fixtures.cases as unknown as readonly Fixture[];

/** Lo que el fixture no pide pero se deduce de él: la línea de entrada que le corresponde. */
const inputLineOf = (fixture: Fixture, index: number) =>
  fixture.input.lines.find((line) => line.index === index);

/** El orden de las aplicaciones no es parte del contrato: se comparan ordenadas por línea y promoción. */
const byLineAndPromotion = (a: PromotionApplication, b: PromotionApplication) =>
  (a.lineIndex ?? Number.MAX_SAFE_INTEGER) - (b.lineIndex ?? Number.MAX_SAFE_INTEGER) ||
  a.promotionKey.localeCompare(b.promotionKey);

describe('evaluatePromotions', () => {
  it('has every fixture case wired', () => {
    expect(CASES.length).toBeGreaterThan(0);
  });

  it.each(CASES.map((fixture) => [fixture.name, fixture] as const))('%s', (_name, fixture) => {
    const result = evaluatePromotions(fixture.input);

    expect(result.orderDiscount).toBe(fixture.expected.orderDiscount);
    expect(result.total).toBe(fixture.expected.total);

    expect(result.lines.map((line) => line.index).sort()).toEqual(
      fixture.expected.lines.map((line) => line.index).sort(),
    );
    for (const expected of fixture.expected.lines) {
      const line = result.lines.find((candidate) => candidate.index === expected.index);
      if (!line) {
        throw new Error(`el motor no devolvió la línea ${expected.index}`);
      }
      expect({
        index: line.index,
        discountAmount: line.discountAmount,
        net: line.net,
        taxAmount: line.taxAmount,
        subtotal: line.subtotal,
      }).toEqual(expected);

      /**
       * El `factor` no viaja en el fixture —el esquema compartido no lo trae—, pero es el número que
       * escala las hijas de un kit (ADR-0003), así que no puede quedar sin atar de este lado.
       *
       * Lo que se afirma no es la fórmula —repetirla sería el mismo código dos veces— sino para qué
       * sirve: aplicarlo al neto de lista tiene que devolver el neto descontado, al centavo. Un
       * factor mal redondeado hace que las hijas del kit no sumen la línea padre.
       */
      const original = inputLineOf(fixture, expected.index)?.net ?? 0;
      expect(round2(original * line.factor)).toBe(round2(line.net));
    }

    expect([...result.applications].sort(byLineAndPromotion)).toEqual(
      [...fixture.expected.applications].sort(byLineAndPromotion),
    );
  });
});
