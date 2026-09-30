import { describe, expect, it } from 'vitest';
import {
  CategoryOption,
  CategoryTreeNodeDto,
  coveredCategoryUuids,
  rootCategoryUuids,
  toCategoryOptions,
} from './category-options';

const TREE: CategoryTreeNodeDto[] = [
  {
    uuid: 'componentes',
    name: 'Componentes de PC',
    subCategories: [
      { uuid: 'motherboards', name: 'Motherboards', subCategories: null },
      {
        uuid: 'teclados',
        name: 'Teclados',
        subCategories: [
          { uuid: 'membrana', name: 'Teclados de membrana', subCategories: null },
          { uuid: 'mecanicos', name: 'Teclados mecánicos', subCategories: null },
        ],
      },
    ],
  },
  { uuid: 'electro', name: 'Electrodomésticos', subCategories: null },
];

function optionsByUuid(): ReadonlyMap<string, CategoryOption> {
  return new Map(toCategoryOptions(TREE).map((option) => [option.uuid, option]));
}

describe('toCategoryOptions', () => {
  it('flattens the tree depth-first, keeping depth and full path', () => {
    expect(toCategoryOptions(TREE).map((option) => [option.uuid, option.depth, option.path])) //
      .toEqual([
        ['componentes', 0, 'Componentes de PC'],
        ['motherboards', 1, 'Componentes de PC / Motherboards'],
        ['teclados', 1, 'Componentes de PC / Teclados'],
        ['membrana', 2, 'Componentes de PC / Teclados / Teclados de membrana'],
        ['mecanicos', 2, 'Componentes de PC / Teclados / Teclados mecánicos'],
        ['electro', 0, 'Electrodomésticos'],
      ]);
  });

  it('resolves each node lineage without counting itself', () => {
    const options = optionsByUuid();

    expect(options.get('teclados')?.ancestorUuids).toEqual(['componentes']);
    expect(options.get('teclados')?.descendantUuids).toEqual(['membrana', 'mecanicos']);
    expect(options.get('mecanicos')?.ancestorUuids).toEqual(['componentes', 'teclados']);
    expect(options.get('mecanicos')?.descendantUuids).toEqual([]);
  });
});

describe('coveredCategoryUuids', () => {
  it('covers the whole subtree of every picked category', () => {
    expect([...coveredCategoryUuids(['teclados'], optionsByUuid())]).toEqual([
      'membrana',
      'mecanicos',
    ]);
  });

  it('leaves a leaf covering nothing', () => {
    expect([...coveredCategoryUuids(['electro'], optionsByUuid())]).toEqual([]);
  });
});

describe('rootCategoryUuids', () => {
  /** Picking the parent absorbs the child: sending both is the pair the price rule backend rejects. */
  it('drops the categories already covered by an ancestor', () => {
    expect(rootCategoryUuids(['mecanicos', 'componentes'], optionsByUuid())).toEqual([
      'componentes',
    ]);
  });

  it('keeps siblings and unrelated branches', () => {
    expect(rootCategoryUuids(['teclados', 'motherboards', 'electro'], optionsByUuid())).toEqual([
      'teclados',
      'motherboards',
      'electro',
    ]);
  });

  it('dedupes without reordering', () => {
    expect(rootCategoryUuids(['electro', 'teclados', 'electro'], optionsByUuid())).toEqual([
      'electro',
      'teclados',
    ]);
  });
});
