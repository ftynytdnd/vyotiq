/**
 * SidebarSearch — inline search input that replaces the `Search` nav row
 * when active. Auto-focuses on mount, exposes a controlled query, and
 * collapses on Esc or empty Enter. The actual filtering happens in
 * `ChatsSection` reading from `useSidebarSearchStore`.
 */

import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useSidebarSearchStore } from '../../store/useSidebarSearchStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { cn } from '../../lib/cn.js';

export function SidebarSearch() {
  const query = useSidebarSearchStore((s) => s.query);
  const setQuery = useSidebarSearchStore((s) => s.setQuery);
  const setOpen = useSidebarSearchStore((s) => s.setOpen);
  // Pulled here only to support Enter-to-select on the top match —
  // ChatsSection still owns the rendered filtered list.
  const conversations = useConversationsStore((s) => s.list);
  const select = useConversationsStore((s) => s.select);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className={cn(
        'app-no-drag flex items-center gap-2 rounded-inner px-2.5 py-1.5',
        'bg-surface-hover text-text-primary'
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
      <input
        ref={inputRef}
        value={query}
        aria-label="Search chats"
        aria-keyshortcuts="Escape Enter"
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
            // Pick the first conversation whose title matches the
            // filter — same logic ChatsSection uses to render — and
            // select it. Collapsing the search after a successful pick
            // mirrors a typical command-palette UX.
            const top = conversations.find((c) => c.title.toLowerCase().includes(q));
            if (top) {
              void select(top.id);
              setOpen(false);
            }
          }
        }}
        placeholder="Search chats…"
        className={cn(
          'min-w-0 flex-1 bg-transparent text-row text-text-primary',
          'placeholder:text-text-muted outline-none focus:outline-none'
        )}
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-inner',
          'text-text-faint transition-colors duration-150',
          'hover:text-text-primary'
        )}
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  );
}
