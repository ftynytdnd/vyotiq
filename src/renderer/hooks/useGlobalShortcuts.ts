/**
 * Window-level accelerators for core app actions (dock tooltips and
 * settings reference the same bindings).
 *
 * Bound at the App root via `useGlobalShortcuts(actions)`. It uses
 * the latest `actions` snapshot through a ref so the handler doesn't
 * re-bind on every render (and never fires a stale closure).
 *
 * Bindings:
 *   - Ctrl/Cmd+N        : new conversation
 *   - Ctrl/Cmd+O        : pick workspace folder (OS dialog)
 *   - Ctrl/Cmd+,        : open Settings (last-used tab)
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
  /** When true, chat/workspace shortcuts are ignored (e.g. settings is open). */
  blockChatActions?: () => boolean;
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
  ref.current = actions;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      if (e.shiftKey && !e.altKey && key === 'i') {
        if (!ref.current.toggleDevTools) return;
        e.preventDefault();
        ref.current.toggleDevTools();
        return;
      }

      if (e.altKey || e.shiftKey) return;

      if (key === 'n') {
        if (ref.current.blockChatActions?.()) return;
        e.preventDefault();
        ref.current.newConversation();
        return;
      }
      if (key === 'o') {
        if (ref.current.blockChatActions?.()) return;
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

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
