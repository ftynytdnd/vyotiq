/**
 * Window-level accelerators for core app actions (dock tooltips and
 * settings reference the same bindings).
 *
 * Bound at the App root via `useGlobalShortcuts(actions)`. It uses
 * the latest `actions` and resolved keybinding snapshot through refs
 * so the handler doesn't re-bind on every render.
 */

import { useEffect, useRef } from 'react';
import {
  defaultKeybindingsRecord,
  eventMatchesCombo,
  type KeybindingId
} from '@shared/keybindings/defaultKeybindings.js';
import { isMacPlatform } from '../lib/resolveKeybindings.js';

export interface GlobalShortcutActions {
  newConversation: () => void;
  openWorkspace: () => void;
  openSettings: () => void;
  /** When true, chat/workspace shortcuts are ignored (e.g. settings is open). */
  blockChatActions?: () => boolean;
  /** Toggle integrated terminal (Ctrl/Cmd+`). */
  toggleTerminal?: () => void;
  blockTerminal?: () => boolean;
  closeWorkbenchTab?: () => void;
  blockWorkbenchTab?: () => boolean;
  cycleWorkbenchTabPrev?: () => void;
  cycleWorkbenchTabNext?: () => void;
  /** Save the active editor file when dirty. */
  saveEditor?: () => void;
  blockSaveEditor?: () => boolean;
  focusComposer?: () => void;
  blockFocusComposer?: () => boolean;
  reload?: () => void;
  toggleDevTools?: () => void;
}

export function useGlobalShortcuts(
  actions: GlobalShortcutActions,
  keybindings?: Record<KeybindingId, string>
): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const bindingsRef = useRef(keybindings);
  bindingsRef.current = keybindings;

  useEffect(() => {
    const bindings = (): Record<KeybindingId, string> =>
      bindingsRef.current ?? defaultKeybindingsRecord(isMacPlatform());

    const onKeyDown = (e: KeyboardEvent) => {
      const b = bindings();

      if (eventMatchesCombo(e, b.toggleDevTools)) {
        if (!actionsRef.current.toggleDevTools) return;
        e.preventDefault();
        actionsRef.current.toggleDevTools();
        return;
      }

      if (eventMatchesCombo(e, b.newConversation)) {
        if (actionsRef.current.blockChatActions?.()) return;
        e.preventDefault();
        actionsRef.current.newConversation();
        return;
      }
      if (eventMatchesCombo(e, b.openWorkspace)) {
        if (actionsRef.current.blockChatActions?.()) return;
        e.preventDefault();
        actionsRef.current.openWorkspace();
        return;
      }
      if (eventMatchesCombo(e, b.openSettings)) {
        e.preventDefault();
        actionsRef.current.openSettings();
        return;
      }
      if (eventMatchesCombo(e, b.focusComposer)) {
        if (!actionsRef.current.focusComposer || actionsRef.current.blockFocusComposer?.()) return;
        e.preventDefault();
        actionsRef.current.focusComposer();
        return;
      }
      if (eventMatchesCombo(e, b.saveEditor)) {
        if (!actionsRef.current.saveEditor || actionsRef.current.blockSaveEditor?.()) return;
        e.preventDefault();
        actionsRef.current.saveEditor();
        return;
      }

      if (eventMatchesCombo(e, b.closeWorkbenchTab)) {
        if (!actionsRef.current.closeWorkbenchTab || actionsRef.current.blockWorkbenchTab?.()) return;
        e.preventDefault();
        actionsRef.current.closeWorkbenchTab();
        return;
      }
      if (eventMatchesCombo(e, b.cycleWorkbenchTabPrev)) {
        if (!actionsRef.current.cycleWorkbenchTabPrev || actionsRef.current.blockWorkbenchTab?.()) return;
        e.preventDefault();
        actionsRef.current.cycleWorkbenchTabPrev();
        return;
      }
      if (eventMatchesCombo(e, b.cycleWorkbenchTabNext)) {
        if (!actionsRef.current.cycleWorkbenchTabNext || actionsRef.current.blockWorkbenchTab?.()) return;
        e.preventDefault();
        actionsRef.current.cycleWorkbenchTabNext();
        return;
      }
      if (eventMatchesCombo(e, b.reload)) {
        if (!actionsRef.current.reload) return;
        e.preventDefault();
        actionsRef.current.reload();
        return;
      }
      if (eventMatchesCombo(e, b.toggleTerminal)) {
        if (!actionsRef.current.toggleTerminal || actionsRef.current.blockTerminal?.()) return;
        e.preventDefault();
        actionsRef.current.toggleTerminal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
