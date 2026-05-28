/**
 * Inline dock search inside the footer shell (Ctrl/Cmd+K or Search button).
 */

import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { filterDockChats } from './filterDockChats.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { cn } from '../../lib/cn.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE, SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

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
      className="mx-2 mb-1 mt-0.5 flex items-center gap-1.5 px-1 pb-1.5"
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
    <>
      <Search className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
      <input
        ref={inputRef}
        type="search"
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
        className="vx-input min-w-0 flex-1 py-0.5 text-row"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className="vx-btn vx-btn-quiet h-6 w-6 shrink-0 px-0"
      >
        <X className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
      </button>
    </>
  );
}
