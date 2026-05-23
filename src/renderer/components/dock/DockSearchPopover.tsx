/**
 * Inline dock search — expands the footer shell when open (toolbar or Ctrl/Cmd+K).
 * Uses normal layout flow so ancestor `overflow-hidden` shells do not clip it.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

export function DockSearchPopover() {
  const open = useDockSearchStore((s) => s.open);
  if (!open) return null;

  return (
    <div
      role="search"
      aria-label="Search chats"
      className="border-b border-border-subtle/25 bg-surface-base/95 px-3 py-2"
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
  const select = useConversationsStore((s) => s.select);
  const activeWs = useWorkspaceStore((s) => s.activeId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-2">
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
            const top = conversations.find(
              (c) => c.workspaceId === activeWs && c.title.toLowerCase().includes(q)
            );
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
