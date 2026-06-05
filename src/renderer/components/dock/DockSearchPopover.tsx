/**
 * Unified dock search at the top of the flyout (Ctrl/Cmd+K or Search button).
 * Groups Chats and Files; file picks preview in-app or attach to composer.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { File, MessageSquare, Paperclip, Search, X } from 'lucide-react';
import { useDockUnifiedSearch, type DockSearchHit } from './useDockUnifiedSearch.js';
import {
  attachDockWorkspaceFile,
  previewDockWorkspaceFile
} from './dockSearchFileActions.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';
import { chromeNoMatchesClassName } from '../ui/SurfaceShell.js';
import {
  SHELL_CHROME_ICON_CLASS,
  SHELL_CHROME_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../lib/shellIcons.js';

const DOCK_SEARCH_ARIA_LABEL = 'Search workspace';

export function DockSearchPopover() {
  const open = useDockSearchStore((s) => s.open);
  if (!open) return null;

  return (
    <div
      role="search"
      aria-label={DOCK_SEARCH_ARIA_LABEL}
      className="flex shrink-0 flex-col gap-0 border-b border-border-subtle/30 px-2 pb-2 pt-1"
    >
      <DockSearchInput />
    </div>
  );
}

function DockSearchInput() {
  const query = useDockSearchStore((s) => s.query);
  const setQuery = useDockSearchStore((s) => s.setQuery);
  const setOpen = useDockSearchStore((s) => s.setOpen);
  const select = useConversationsStore((s) => s.select);
  const activeWs = useWorkspaceStore((s) => s.activeId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { chats, files, flat, loadingFiles, isFiltering } = useDockUnifiedSearch(
    query,
    true,
    activeWs
  );

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, chats.length, files.length]);

  const activateHit = useCallback(
    async (hit: DockSearchHit) => {
      if (hit.kind === 'chat') {
        void select(hit.id);
        setOpen(false);
        return;
      }
      const attached = await attachDockWorkspaceFile(hit.path);
      if (attached) {
        setOpen(false);
        return;
      }
      await previewDockWorkspaceFile(hit.path);
      setOpen(false);
    },
    [select, setOpen]
  );

  const onEnter = () => {
    const q = query.trim();
    if (q.length === 0) {
      setOpen(false);
      return;
    }
    const hit = activeIndex >= 0 ? flat[activeIndex] : flat[0];
    if (hit) void activateHit(hit);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 px-0.5">
        <Search
          className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          value={query}
          aria-label={DOCK_SEARCH_ARIA_LABEL}
          aria-controls="dock-unified-search-results"
          aria-expanded={isFiltering}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              return;
            }
            if (e.key === 'ArrowDown') {
              if (flat.length === 0) return;
              e.preventDefault();
              setActiveIndex((i) => (i + 1) % flat.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              if (flat.length === 0) return;
              e.preventDefault();
              setActiveIndex((i) => (i <= 0 ? flat.length - 1 : i - 1));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder="Search chats and files…"
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
      </div>

      {isFiltering && (
        <div
          id="dock-unified-search-results"
          role="listbox"
          aria-label="Search results"
          className="mt-1 max-h-56 overflow-y-auto rounded-inner bg-surface-input/40 px-0.5 py-0.5"
        >
          {flat.length === 0 && !loadingFiles && (
            <div className={cn(chromeNoMatchesClassName, 'py-2')}>No matches.</div>
          )}
          {loadingFiles && flat.length === 0 && (
            <div className={cn(chromeNoMatchesClassName, 'py-2')}>Loading files…</div>
          )}
          {chats.length > 0 && (
            <SearchGroup label="Chats">
              {chats.map((hit, i) => (
                <SearchRow
                  key={hit.id}
                  active={activeIndex === i}
                  icon={<MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />}
                  label={hit.title}
                  onSelect={() => void activateHit(hit)}
                  onHover={() => setActiveIndex(i)}
                />
              ))}
            </SearchGroup>
          )}
          {files.length > 0 && (
            <SearchGroup label="Files">
              {files.map((hit, i) => {
                const flatIndex = chats.length + i;
                return (
                  <SearchRow
                    key={hit.path}
                    active={activeIndex === flatIndex}
                    icon={<File className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />}
                    label={hit.path}
                    mono
                    trailing={
                      <Paperclip
                        className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')}
                        strokeWidth={SHELL_ROW_ICON_STROKE}
                        aria-hidden
                      />
                    }
                    onSelect={() => void activateHit(hit)}
                    onHover={() => setActiveIndex(flatIndex)}
                  />
                );
              })}
            </SearchGroup>
          )}
        </div>
      )}
    </>
  );
}

function SearchGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-0.5">
      <div className="px-2 pb-0.5 text-meta font-medium uppercase tracking-wide text-text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function SearchRow({
  label,
  icon,
  mono = false,
  trailing,
  active,
  onSelect,
  onHover
}: {
  label: string;
  icon: ReactNode;
  mono?: boolean;
  trailing?: ReactNode;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        'vx-dropdown-item flex w-full items-center gap-2 px-2 py-1 text-left text-row',
        active && 'bg-chrome-hover-soft/80'
      )}
    >
      <span className="text-text-faint">{icon}</span>
      <span className={cn('min-w-0 flex-1 truncate', mono && 'font-mono')}>{label}</span>
      {trailing}
    </button>
  );
}
