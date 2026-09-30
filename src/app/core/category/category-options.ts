/**
 * El árbol de categorías como opciones de un select, con el linaje de cada nodo resuelto.
 *
 * Vive en `core` y no en un feature porque no es de ninguno: es aritmética sobre el árbol que
 * devuelve `GET /category/getAllTree`, y la necesitan por igual la regla de precio y la promoción
 * —las dos alcanzan categorías «con todo su subárbol»—. Son funciones puras, sin inyección: a
 * diferencia de un `*ApiService` de feature, importarlas desde otra feature no rompe nada en runtime.
 */

/** Nodo recursivo de `GET /category/getAllTree`. Hoja ⇒ `subCategories: null`. */
export interface CategoryTreeNodeDto {
  uuid: string;
  name: string;
  subCategories: CategoryTreeNodeDto[] | null;
}

/** Opción de categoría: el árbol aplanado con su profundidad y su ruta completa. */
export interface CategoryOption {
  uuid: string;
  name: string;
  depth: number;
  /** `Bebidas / Gaseosas`, que es lo que distingue dos categorías homónimas de ramas distintas. */
  path: string;
  /** Ancestros, de la raíz hacia abajo: con ellos se sabe si otra selección ya alcanza a esta categoría. */
  ancestorUuids: string[];
  /** Subárbol completo por debajo del nodo: lo que arrastra elegir esta categoría. */
  descendantUuids: string[];
}

/** Aplanado depth-first del árbol de categorías, con el linaje de cada nodo resuelto. */
export function toCategoryOptions(nodes: readonly CategoryTreeNodeDto[]): CategoryOption[] {
  const options: CategoryOption[] = [];
  collectCategoryOptions(nodes, 0, '', [], options);
  return options;
}

function collectCategoryOptions(
  nodes: readonly CategoryTreeNodeDto[],
  depth: number,
  parentPath: string,
  ancestorUuids: readonly string[],
  target: CategoryOption[],
): void {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    target.push({
      uuid: node.uuid,
      name: node.name,
      depth,
      path,
      ancestorUuids: [...ancestorUuids],
      descendantUuids: collectDescendantUuids(node),
    });
    collectCategoryOptions(
      node.subCategories ?? [],
      depth + 1,
      path,
      [...ancestorUuids, node.uuid],
      target,
    );
  }
}

function collectDescendantUuids(node: CategoryTreeNodeDto): string[] {
  const uuids: string[] = [];

  for (const child of node.subCategories ?? []) {
    uuids.push(child.uuid, ...collectDescendantUuids(child));
  }

  return uuids;
}

/**
 * Reduce una selección a sus **raíces**: las categorías que no cuelgan de otra ya elegida.
 *
 * Elegir un padre alcanza a todo su subárbol, así que mandar además a las hijas sería redundante.
 * Es lo que se persiste y lo que se muestra como chips; lo heredado se deriva con
 * {@link coveredCategoryUuids}.
 */
export function rootCategoryUuids(
  uuids: readonly string[],
  optionsByUuid: ReadonlyMap<string, CategoryOption>,
): string[] {
  const covered = coveredCategoryUuids(uuids, optionsByUuid);
  return [...new Set(uuids)].filter((uuid) => !covered.has(uuid));
}

/** Descendientes de las categorías elegidas: quedan alcanzados por herencia, sin estar seleccionados. */
export function coveredCategoryUuids(
  uuids: readonly string[],
  optionsByUuid: ReadonlyMap<string, CategoryOption>,
): Set<string> {
  const covered = new Set<string>();

  for (const uuid of uuids) {
    for (const descendant of optionsByUuid.get(uuid)?.descendantUuids ?? []) {
      covered.add(descendant);
    }
  }

  return covered;
}

/**
 * Cada categoría con su **cadena hasta la raíz**: ella misma primero, después sus ancestros.
 *
 * Es la forma que consume el motor de promociones. Con la cadena ya resuelta, «la categoría incluye
 * todo su subárbol» se reduce a una intersección de conjuntos: la promoción guarda las raíces que
 * alguien eligió y la línea trae su linaje, así que alcanza con que se toquen en un punto. Derivarlo
 * al revés —expandir el subárbol de cada promoción— daría lo mismo y costaría una expansión por
 * promoción en vez de una por producto.
 */
export function toCategoryChains(
  options: readonly CategoryOption[],
): ReadonlyMap<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>();

  for (const option of options) {
    // Los ancestros vienen de la raíz hacia abajo; la cadena arranca por la categoría propia porque
    // es la que más se compara, pero el orden no cambia el resultado de la intersección.
    chains.set(option.uuid, [option.uuid, ...[...option.ancestorUuids].reverse()]);
  }

  return chains;
}
