/**
 * Window-level menu accelerators that match the labels rendered in
 * `FileMenu` and `ViewMenu`. The titlebar menu only shows the
 * keystroke as decorative text — without a real handler the user
 * would learn the shortcut from the UI and find it doesn't do
 * anything. This hook closes that gap.
 *
 * Bound at the App root via `useGlobalShortcuts(actions)`. It uses
 * the latest `actions` snapshot through a ref so the handler doesn't
 * re-bind on every render (and never fires a stale closure).
 *
 * Bindings:
 *   - Ctrl/Cmd+N        : new conversation
 *   - Ctrl/Cmd+O        : pick workspace folder (OS dialog)
 *   - Ctrl/Cmd+,        : open Settings (last-used tab)
 *   - Ctrl/Cmd+Shift+H  : open Checkpoints history
 *   - Ctrl/Cmd+Shift+C  : open Context Inspector
 *   - Ctrl/Cmd+R        : reload the renderer (View → Reload)
 *   - Ctrl/Cmd+Shift+I  : toggle DevTools (View → Toggle DevTools)
 *
 * `reload` and `toggleDevTools` are optional — when undefined, the
 * hook silently skips the keystroke and lets Electron's defaults (if
 * any) handle it. Wired ones run irrespective of focus target so the
 * shortcut works even when the composer textarea has focus, mirroring
 * how every Electron desktop app behaves.
 */

import { useEffect, useRef } from 'react';

export interface GlobalShortcutActions {
  newConversation: () => void;
  openWorkspace: () => void;
  openSettings: () => void;
  openCheckpoints?: () => void;
  /** Opens the Context Inspector for the active conversation or run. */
  openContextInspector?: () => void;
  /**
   * Reload handler for `Ctrl/Cmd+R`. Optional so consumers (and the
   * existing test harness) can leave it undefined when they don't
   * care about the View-menu shortcuts.
   */
  reload?: () => void;
  /**
   * DevTools toggle for `Ctrl/Cmd+Shift+I`. Optional for the same
   * reason as `reload`.
   */
  toggleDevTools?: () => void;
}

export function useGlobalShortcuts(actions: GlobalShortcutActions): void {
  const ref = useRef(actions);
  // Keep the ref pointing at the latest actions object so closures
  // captured by addEventListener stay current without forcing a
  // re-bind. We only need the ref to be updated synchronously before
  // any keystroke arrives, which the render-time assignment guarantees.
  ref.current = actions;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      // Ctrl/Cmd+Shift+I — DevTools toggle. Checked BEFORE the
      // letter shortcuts because those reject any Shift modifier.
      // `e.key` is `'I'` on Windows when Shift is held, so we
      // lowercase it for the comparison.
      if (e.shiftKey && !e.altKey && key === 'i') {
        if (!ref.current.toggleDevTools) return;
        e.preventDefault();
        ref.current.toggleDevTools();
        return;
      }

      // Ctrl/Cmd+Shift+H — Checkpoints history.
      if (e.shiftKey && !e.altKey && key === 'h') {
        if (!ref.current.openCheckpoints) return;
        e.preventDefault();
        ref.current.openCheckpoints();
        return;
      }

      // Ctrl/Cmd+Shift+C — Context Inspector.
      if (e.shiftKey && !e.altKey && key === 'c') {
        if (!ref.current.openContextInspector) return;
        e.preventDefault();
        ref.current.openContextInspector();
        return;
      }

      // Letter / punctuation shortcuts — strict: no Shift, no Alt.
      // Adding either to one of these combos must not silently fire
      // the bare shortcut.
      if (e.altKey || e.shiftKey) return;

      if (key === 'n') {
        e.preventDefault();
        ref.current.newConversation();
        return;
      }
      if (key === 'o') {
        e.preventDefault();
        ref.current.openWorkspace();
        return;
      }
      if (key === ',') {
        e.preventDefault();
        ref.current.openSettings();
        return;
      }
      if (key === 'r') {
        if (!ref.current.reload) return;
        e.preventDefault();
        ref.current.reload();
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Release tracking is a no-op today; paired listener ensures
      // symmetric teardown on unmount (audit Phase 3).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
