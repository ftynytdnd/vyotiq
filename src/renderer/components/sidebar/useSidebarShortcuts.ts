/**
 * Sidebar keyboard shortcuts.
 *
 * Bound at the window level on mount of the `Sidebar` component:
 *
 *   - Ctrl+B / Cmd+B : toggle the sidebar visibility (works even when focus
 *                      is in the composer textarea — the View menu's
 *                      decorative "Ctrl+B" hint never actually wired a
 *                      real shortcut).
 *   - Alt+ArrowUp /
 *     Alt+ArrowDown   : navigate prev / next conversation in the current
 *                      (filtered) chat list. Wraps at top/bottom. Skipped
 *                      when focus is in an input/textarea/contenteditable
 *                      so it doesn't fight text-edit cursor movement.
 *   - Ctrl+K / Cmd+K  : open the inline sidebar search and focus the input
 *                      (intercepted globally — the renderer doesn't ship a
 *                      browser find-in-page).
 *
 * Filtering for Alt+ArrowUp/Down is recomputed inside the handler from the
 * stores so the navigation always reflects the live (post-search-filter)
 * list — no stale closure.
 */

import { useEffect } from 'react';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useSidebarSearchStore } from '../../store/useSidebarSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useSidebarShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd+B → toggle sidebar (works even from text inputs).
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        useUiStore.getState().toggleSidebar();
        return;
      }

      // Ctrl/Cmd+K → open + focus sidebar search.
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        // Only intercept when the sidebar is open; otherwise let the
        // keystroke pass through unchanged.
        if (!useUiStore.getState().sidebarOpen) return;
        e.preventDefault();
        useSidebarSearchStore.getState().setOpen(true);
        return;
      }

      // Alt+ArrowUp / Alt+ArrowDown → prev / next conversation. Skipped
      // while focus is in a text-editing element so it never fights the
      // user's caret movement.
      if (
        e.altKey &&
        !mod &&
        !e.shiftKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      ) {
        if (isTextInputTarget(e.target)) return;
        e.preventDefault();
        navigateConversation(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

function navigateConversation(dir: 1 | -1): void {
  const convs = useConversationsStore.getState();
  const search = useSidebarSearchStore.getState();
  const activeWs = useWorkspaceStore.getState().activeId;
  if (!activeWs) return;

  // Filter to the ACTIVE workspace's group — navigation never crosses
  // workspaces. Cross-workspace nav would require flipping the active
  // workspace mid-shortcut, which the keyboard model intentionally
  // doesn't do (the sidebar tree owns that affordance).
  const inWorkspace = convs.list.filter((c) => c.workspaceId === activeWs);
  const list = search.open && search.query.trim().length > 0
    ? inWorkspace.filter((c) =>
      c.title.toLowerCase().includes(search.query.trim().toLowerCase())
    )
    : inWorkspace;
  if (list.length === 0) return;

  const activeId = convs.activeIdByWorkspace[activeWs] ?? null;
  const activeIdx = activeId
    ? list.findIndex((c) => c.id === activeId)
    : -1;
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
