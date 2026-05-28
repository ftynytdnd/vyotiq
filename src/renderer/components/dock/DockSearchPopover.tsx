/**
 * Inline dock search inside the footer shell (Ctrl/Cmd+K or Search button).
 */

import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { chromeEdgeClassName, chromeSearchRowClassName } from '../ui/SurfaceShell.js';
import { filterDockChats } from './filterDockChats.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { TextField } from '../ui/TextField.js';
import { chromeIconPillClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

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
      className={cn(
        chromeSearchRowClassName,
        'border-b bg-transparent',
        chromeEdgeClassName,
        'mx-2 mb-1 mt-0.5 px-2 py-1'
      )}
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
      <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
      <TextField
        ref={inputRef}
        size="sm"
        tone="transparent"
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
        className="min-w-0 flex-1 px-0"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className={chromeIconPillClassName()}
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </>
  );
}
