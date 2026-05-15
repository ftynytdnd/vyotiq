/**
 * Sidebar row focus registry.
 *
 * Each `ChatHistoryList` row registers its DOM element with a stable
 * id via `useSidebarRowFocus(id, ref)` on mount. Cross-component
 * callers (e.g. the composer's "running elsewhere" hint) ask
 * `focusRow(id)` to:
 *
 *   1. Open the sidebar if it is collapsed (`useUiStore.setSidebarOpen(true)`).
 *   2. Scroll the registered element into view (`scrollIntoView`).
 *
 * The registry is module-scoped — at most a few hundred entries — so a
 * plain `Map` is plenty. Cleanup on unmount keeps it tight.
 *
 * `focusRow` is intentionally a free function (not a hook) so the
 * composer's hint button can call it from inside an event handler
 * without a re-render. Returns `false` when the row is not registered
 * (the conversation may have been deleted between the hint render and
 * the click) so callers can fall back to a no-op gracefully.
 */

import { useEffect, useRef } from 'react';
import { useUiStore } from '../../store/useUiStore.js';

const registry = new Map<string, HTMLElement>();

/**
 * Register the row element for `id` on mount; unregister on unmount.
 * The hook returns a `ref` callback the consumer attaches to the
 * row's outer element. We use a callback ref (rather than a passed-in
 * ref) so consumers don't have to thread a `useRef` of their own.
 */
export function useSidebarRowFocus(id: string): (el: HTMLElement | null) => void {
  // Track the last-registered element so we can unregister exactly
  // that one if the consumer's element identity changes mid-life.
  const lastRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      const el = lastRef.current;
      if (el && registry.get(id) === el) registry.delete(id);
      lastRef.current = null;
    };
  }, [id]);

  return (el: HTMLElement | null) => {
    const prev = lastRef.current;
    if (prev && prev !== el && registry.get(id) === prev) {
      registry.delete(id);
    }
    if (el) {
      registry.set(id, el);
      lastRef.current = el;
    } else {
      lastRef.current = null;
    }
  };
}

/**
 * Open the sidebar (if collapsed) and scroll the row registered for
 * `id` into view. Returns `true` when the row was found.
 */
export function focusRow(id: string): boolean {
  useUiStore.getState().setSidebarOpen(true);
  const el = registry.get(id);
  if (!el) return false;
  // Defer past the sidebar-open transition so the layout has settled
  // before we measure / scroll. A microtask is sufficient — the
  // CSS transition is cosmetic and the underlying scrollHeight is
  // already correct as soon as `sidebarOpen` flips.
  queueMicrotask(() => {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      /* environments without scrollIntoView (test happy-dom) — silent */
    }
  });
  return true;
}

/**
 * Test-only helper. Drops every registered row so a fresh test fixture
 * doesn't see entries left over from a prior test's mount.
 */
export function __resetSidebarRowRegistry(): void {
  registry.clear();
}
