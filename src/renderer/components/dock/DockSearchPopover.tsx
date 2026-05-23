/**
 * Inline dock search above the footer toolbar (Ctrl/Cmd+K or Search button).
 */

import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { DOCK_BORDER_OPACITY } from './dockShared.js';
import { filterDockChats } from './filterDockChats.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useChatStore } from '../../store/useChatStore.js';

function collectRunningIds(): Set<string> {
  const set = new Set<string>();
  for (const [id, slice] of Object.entries(useChatStore.getState().slices)) {
    if (slice.isProcessing) set.add(id);
  }
  return set;
}

export function DockSearchPopover() {
  const open = useDockSearchStore((s) => s.open);
  if (!open) return null;

  return (
    <div
      role="search"
      aria-label="Search chats"
      className={`border-b ${DOCK_BORDER_OPACITY} px-2 py-1.5`}
    >
      <DockSearchInput />
    </div>
  );
}

function DockSearchInput() {
  const query = useDockSearchStore((s) => s.query);
  const setQuery = useDockSearchStore((s) => s.setQuery);
  const setOpen = useDockSearchStore((s) => s.setOpen);
  const conversations = useConversationsStore((s) => s.list);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const select = useConversationsStore((s) => s.select);
  const activeWs = useWorkspaceStore((s) => s.activeId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <Search className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} aria-hidden />
      <input
        ref={inputRef}
        value={query}
        aria-label="Search chats"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const q = query.trim().toLowerCase();
            if (q.length === 0) {
              setOpen(false);
              return;
            }
            if (!activeWs) return;
            const activeId = activeIdByWorkspace[activeWs] ?? null;
            const matches = filterDockChats(
              conversations,
              activeWs,
              query,
              true,
              collectRunningIds(),
              activeId
            );
            const top = matches[0];
            if (top) {
              void select(top.id);
              setOpen(false);
            }
          }
        }}
        placeholder="Search chats in this workspace…"
        className="min-w-0 flex-1 bg-transparent text-row text-text-primary outline-none placeholder:text-text-muted"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className="app-no-drag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner text-text-faint hover:text-text-primary"
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  );
}
