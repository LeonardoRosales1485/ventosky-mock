import { describe, expect, it } from 'vitest';
import { productCatalogStateChip, toProductCatalogState } from './product-catalog-state';

describe('toProductCatalogState', () => {
  it('reconoce los dos estados que el backend informa', () => {
    expect(toProductCatalogState('ARCHIVED')).toBe('ARCHIVED');
    expect(toProductCatalogState('DISCONTINUED')).toBe('DISCONTINUED');
  });

  it('trata la ausencia como «sigue en circulación» y no como un estado', () => {
    // El backend omite el campo a propósito: el producto que se dejó de comprar pero se sigue
    // vendiendo es un activo en liquidación, y marcarlo mandaría a revisar el catálogo al pedo.
    expect(toProductCatalogState(null)).toBeNull();
    expect(toProductCatalogState(undefined)).toBeNull();
  });

  it('un valor desconocido no se inventa un estado', () => {
    // Un backend más nuevo con un estado que esta versión no conoce: la línea se muestra sin marca,
    // que es exactamente cómo se veía antes de que el campo existiera.
    expect(toProductCatalogState('SUSPENDED')).toBeNull();
  });
});

describe('productCatalogStateChip', () => {
  it('marca el archivado y el discontinuado con chips distintos', () => {
    // «Distinguible del anterior» es un criterio del ticket: los dos estados no son lo mismo —uno se
    // deshace y el otro no (ADR 0001)— y un solo chip para los dos borraría la diferencia.
    const archived = productCatalogStateChip('ARCHIVED');
    const discontinued = productCatalogStateChip('DISCONTINUED');

    expect(archived?.id).toBe('archived');
    expect(discontinued?.id).toBe('discontinued');
    expect(archived?.labelKey).not.toBe(discontinued?.labelKey);
  });

  it('reusa la etiqueta del catálogo para el discontinuado', () => {
    // El mismo producto dice lo mismo en la grilla y en la línea de una venta vieja.
    expect(productCatalogStateChip('DISCONTINUED')?.labelKey).toBe('products.chips.discontinued');
  });

  it('el producto en circulación no lleva chip', () => {
    expect(productCatalogStateChip(null)).toBeNull();
  });
});
