/** Lo mínimo que una fila del paginado tiene que traer para poder colapsarla por modelo. */
export interface SuggestionProduct {
  uuid: string;
  name: string;
  totalStock?: number | null;
  /** El modelo que agrupa a esta variante, o ausente en un producto suelto (RN-11). */
  model?: { uuid: string; name: string } | null;
}

/**
 * Una fila del autocompletado: un producto suelto, o **un modelo** que representa a sus variantes.
 *
 * El modelo no es agregable —no se vende ni se compra (RN-12)—: elegirlo abre el selector de
 * variante. Por eso la fila lleva las variantes que colapsó, y no sólo su nombre.
 */
export type SuggestionRow<P extends SuggestionProduct = SuggestionProduct> =
  | { kind: 'product'; product: P }
  | {
      kind: 'model';
      modelUuid: string;
      modelName: string;
      variants: readonly P[];
      /** La suma del stock de las variantes: lo que la fila muestra en vez del de una sola. */
      totalStock: number;
    };

type ModelRow<P extends SuggestionProduct> = Extract<SuggestionRow<P>, { kind: 'model' }>;

/**
 * Colapsa las variantes de un modelo en una sola fila del buscador (§5.6, wireframe `1l`).
 *
 * Es la mitad del valor de la entrega en el mostrador: **doce variantes que inundan la lista son
 * doce filas que el operador tiene que leer** para encontrar el talle, con el cliente esperando. El
 * modelo aparece una vez, donde apareció su primera variante, y elegirlo abre el selector.
 *
 * Vive en `core/` porque el punto de venta y la compra hacen exactamente lo mismo: el remito del
 * proveedor también nombra el modelo, y doce variantes sueltas en el buscador de la compra son el
 * mismo problema. Los productos sueltos no cambian en nada, que son la enorme mayoría de cualquier
 * catálogo.
 */
export function collapseByModel<P extends SuggestionProduct>(
  products: readonly P[],
): SuggestionRow<P>[] {
  const rows: SuggestionRow<P>[] = [];
  const byModel = new Map<string, ModelRow<P>>();

  for (const product of products) {
    const modelUuid = product.model?.uuid;
    if (!modelUuid) {
      rows.push({ kind: 'product', product });
      continue;
    }

    const existing = byModel.get(modelUuid);
    if (existing) {
      existing.variants = [...existing.variants, product];
      existing.totalStock += product.totalStock ?? 0;
      continue;
    }

    const row: ModelRow<P> = {
      kind: 'model',
      modelUuid,
      modelName: product.model?.name ?? product.name,
      variants: [product],
      totalStock: product.totalStock ?? 0,
    };
    byModel.set(modelUuid, row);
    rows.push(row);
  }

  return rows;
}

/** La clave de `track` del autocompletado: el uuid del producto o el del modelo. */
export function suggestionKey(row: SuggestionRow): string {
  return row.kind === 'model' ? row.modelUuid : row.product.uuid;
}
