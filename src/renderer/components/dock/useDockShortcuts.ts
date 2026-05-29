/**
 * Left dock keyboard shortcuts.
 *
 * Bound at the window level on mount of `LeftDock`:
 *
 *   - Ctrl+B / Cmd+B : toggle dock expand/collapse
 *   - Ctrl+K / Cmd+K  : open inline chat search
 *   - Escape          : close search, else collapse expanded dock
 *   - Alt+ArrowUp/Down : prev/next conversation in active workspace
 */

import { useEffect } from 'react';
import { filterDockChats } from './filterDockChats.js';
import { collectRunningChatIds } from './collectRunningChatIds.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

/** Dock inline search input — Escape is handled locally (must not collapse flyout). */
function isDockSearchInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[role="search"][aria-label="Search chats"]') !== null;
}

export function useDockShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useUiStore.getState().toggleDock();
        return;
      }

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUiStore.getState().setDockExpanded(true);
        useDockSearchStore.getState().setOpen(true);
        return;
      }

      if (e.key === 'Escape') {
        if (isDockSearchInputTarget(e.target)) return;
        const search = useDockSearchStore.getState();
        if (search.open) {
          e.preventDefault();
          search.setOpen(false);
          return;
        }
        if (useUiStore.getState().dockExpanded && !isTextInputTarget(e.target)) {
          e.preventDefault();
          useUiStore.getState().setDockExpanded(false);
        }
        return;
      }

      if (
        e.altKey &&
        !mod &&
        !e.shiftKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        navigateConversation(e.key === 'ArrowDown' ? 1 : -1);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function navigateConversation(dir: 1 | -1): void {
  const convs = useConversationsStore.getState();
  const search = useDockSearchStore.getState();
  const activeWs = useWorkspaceStore.getState().activeId;
  if (!activeWs) return;

  const activeId = convs.activeIdByWorkspace[activeWs] ?? null;
  const list = filterDockChats(
    convs.list,
    activeWs,
    search.query,
    search.open,
    collectRunningChatIds(),
    activeId
  );
  if (list.length === 0) return;

  const activeIdx = activeId ? list.findIndex((c) => c.id === activeId) : -1;
  let next: number;
  if (activeIdx === -1) {
    next = dir === 1 ? 0 : list.length - 1;
  } else {
    next = (activeIdx + dir + list.length) % list.length;
  }
  const target = list[next];
  if (!target || target.id === activeId) return;
  void convs.select(target.id);
}
