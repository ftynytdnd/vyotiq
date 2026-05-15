/**
 * Window-level menu accelerators that match the labels rendered in
 * `FileMenu`. The titlebar menu only shows the keystroke as decorative
 * text — without a real handler the user would learn the shortcut from
 * the UI and find it doesn't do anything. This hook closes that gap.
 *
 * Bound at the App root via `useGlobalShortcuts(fileActions)`. It uses
 * the latest `actions` snapshot through a ref so the handler doesn't
 * re-bind on every render (and never fires a stale closure).
 *
 * Bindings:
 *   - Ctrl/Cmd+N   : new conversation
 *   - Ctrl/Cmd+O   : pick workspace folder (OS dialog)
 *   - Ctrl/Cmd+,   : open Settings → Providers
 *
 * These are intentionally swallowed even when focus is in the composer
 * textarea — the alternative (suppressing the shortcut while editing)
 * means the user can never use the shortcut once they start typing,
 * which mirrors how every Electron desktop app behaves.
 */

import { useEffect, useRef } from 'react';

export interface GlobalShortcutActions {
  newConversation: () => void;
  openWorkspace: () => void;
  openSettings: () => void;
}

export function useGlobalShortcuts(actions: GlobalShortcutActions): void {
  const ref = useRef(actions);
  // Keep the ref pointing at the latest actions object so closures
  // captured by addEventListener stay current without forcing a
  // re-bind. We only need the ref to be updated synchronously before
  // any keystroke arrives, which the render-time assignment guarantees.
  ref.current = actions;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey || e.shiftKey) return;

      const key = e.key.toLowerCase();
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
