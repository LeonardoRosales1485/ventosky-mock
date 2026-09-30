import { describe, expect, it } from 'vitest';
import { escapeLikeWildcards } from './paginate-sql-dialect';

describe('escapeLikeWildcards', () => {
  it('leaves a plain code untouched', () => {
    expect(escapeLikeWildcards('7790895000123')).toBe('7790895000123');
  });

  /**
   * Es lo que permite usar `ILIKE` como una igualdad que ignora mayúsculas: sin escapar, el `_` de
   * un SKU matchea cualquier caracter y el mostrador agregaría el producto equivocado.
   */
  it('escapes the wildcards so the pattern only matches itself', () => {
    expect(escapeLikeWildcards('ABC_1')).toBe('ABC\\_1');
    expect(escapeLikeWildcards('50%')).toBe('50\\%');
  });

  it('escapes the escape character itself', () => {
    expect(escapeLikeWildcards('A\\B')).toBe('A\\\\B');
  });
});
