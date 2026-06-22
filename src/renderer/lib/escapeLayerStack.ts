/**
 * Central Escape-key priority stack — one capture listener while layers are registered.
 */

interface EscapeLayer {
  id: string;
  priority: number;
  onEscape: () => boolean;
}

const layers = new Map<string, EscapeLayer>();
let listenerAttached = false;

function onDocumentKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const sorted = [...layers.values()].sort((a, b) => b.priority - a.priority);
  for (const layer of sorted) {
    if (layer.onEscape()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
  }
}

function ensureListener(): void {
  if (listenerAttached) return;
  document.addEventListener('keydown', onDocumentKeyDown, true);
  listenerAttached = true;
}

function maybeDetachListener(): void {
  if (layers.size > 0) return;
  document.removeEventListener('keydown', onDocumentKeyDown, true);
  listenerAttached = false;
}

/** Register a dismiss layer. Higher `priority` wins. Return value `true` = handled. */
export function registerEscapeLayer(
  id: string,
  priority: number,
  onEscape: () => boolean
): () => void {
  layers.set(id, { id, priority, onEscape });
  ensureListener();
  return () => {
    layers.delete(id);
    maybeDetachListener();
  };
}

/** True when focus is inside any of the given roots (not bare `body`). */
export function escapeFocusInRoots(
  active: Element | null,
  roots: readonly (HTMLElement | null | undefined)[]
): boolean {
  if (!active || active === document.body) return false;
  for (const root of roots) {
    if (root?.contains(active)) return true;
  }
  return false;
}

/** Test-only reset. */
export function __test_resetEscapeLayerStack(): void {
  layers.clear();
  maybeDetachListener();
}
