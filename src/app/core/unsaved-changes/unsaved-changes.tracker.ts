import { DestroyRef, Signal, computed, inject, signal } from '@angular/core';

/**
 * Lo que `unsavedChangesGuard` le pide a la pantalla que protege. Tiene que ser público —no
 * `protected`— porque el guard lo lee desde afuera del componente.
 */
export interface HasUnsavedChanges {
  readonly hasUnsavedChanges: Signal<boolean>;
}

export interface UnsavedChangesTracker {
  /** `true` cuando el modelo se apartó de la última foto tomada. */
  readonly hasUnsavedChanges: Signal<boolean>;
  /** Fija el punto de partida: al terminar de cargar la pantalla y después de guardar. */
  capture(): void;
}

/**
 * Avisa si un formulario tiene cambios sin guardar comparando su modelo contra una foto tomada por
 * la pantalla.
 *
 * Compara valores en vez de mirar `dirty()` de Signal Forms a propósito: ese flag sólo se enciende
 * cuando la escritura pasa por el control (los inputs con `[formField]`), así que un `mat-select` o
 * un `mat-checkbox` atados con `[value]`/`(valueChange)` —el patrón que usa toda la app— lo dejan
 * apagado. La comparación no depende de por dónde se escriba el modelo, ignora la hidratación de
 * una edición y tampoco se queja cuando el usuario tipea algo y lo deshace.
 *
 * Se llama como inicializador de campo del componente, así que corre dentro del contexto de
 * inyección y puede colgarse del `DestroyRef` para desenganchar el listener de `beforeunload`.
 */
export function trackUnsavedChanges<T>(model: Signal<T>): UnsavedChangesTracker {
  const baseline = signal<{ value: T } | null>(null);

  const hasUnsavedChanges = computed(() => {
    const snapshot = baseline();
    // Sin foto la pantalla todavía está cargando: no hay nada que el usuario pueda perder.
    return snapshot !== null && !deepEquals(snapshot.value, model());
  });

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!hasUnsavedChanges()) {
      return;
    }

    // El navegador muestra su propio texto e ignora el nuestro, pero `preventDefault` y
    // `returnValue` siguen siendo necesarios para que el aviso aparezca en todos.
    event.preventDefault();
    event.returnValue = '';
  };

  window.addEventListener('beforeunload', onBeforeUnload);
  inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', onBeforeUnload));

  return {
    hasUnsavedChanges,
    capture: () => baseline.set({ value: model() }),
  };
}

/**
 * Comparación estructural sobre los modelos de formulario: objetos planos, arrays y primitivas.
 * `JSON.stringify` sería más corto pero dependería del orden en que se armaron las claves, que
 * cambia con cada `{ ...current, ... }`.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEquals(item, b[index]))
    );
  }

  const entriesA = Object.entries(a as Record<string, unknown>);
  const entriesB = Object.entries(b as Record<string, unknown>);

  return (
    entriesA.length === entriesB.length &&
    entriesA.every(
      ([key, value]) =>
        Object.hasOwn(b, key) && deepEquals(value, (b as Record<string, unknown>)[key]),
    )
  );
}
