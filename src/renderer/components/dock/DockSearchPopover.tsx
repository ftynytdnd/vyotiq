/**
 * Unified dock search at the top of the flyout (Ctrl/Cmd+K or Search button).
 * Groups Skills, Chats, Messages, and Files.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { File, MessageSquare, Paperclip, Search, Sparkles, X } from 'lucide-react';
import {
  useDockUnifiedSearch,
  type DockSearchHit
} from './useDockUnifiedSearch.js';
import {
  attachDockWorkspaceFile,
  previewDockWorkspaceFile
} from './dockSearchFileActions.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { focusComposer } from '../../lib/focusComposer.js';
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
  const queryValue = useDockSearchStore((s) => s.query);
  const setQuery = useDockSearchStore((s) => s.setQuery);
  const setOpen = useDockSearchStore((s) => s.setOpen);
  const setPendingTimelineScroll = useDockSearchStore((s) => s.setPendingTimelineScroll);
  const select = useConversationsStore((s) => s.select);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActive);
  const conversationId = useChatStore((s) => s.conversationId);
  const setDraft = useChatStore((s) => s.setDraft);
  const activeWs = useWorkspaceStore((s) => s.activeId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { skills, chats, messages, files, flat, loadingFiles, loadingMessages, filesLoadError, isFiltering } =
    useDockUnifiedSearch(queryValue, true, activeWs);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setActiveIndex(-1);
  }, [queryValue, skills.length, chats.length, messages.length, files.length]);

  const activateHit = useCallback(
    async (hit: DockSearchHit) => {
      if (hit.kind === 'skill') {
        const draftId = conversationId;
        if (draftId) {
          setDraft(draftId, `/${hit.displayName} `);
        }
        focusComposer();
        setOpen(false);
        return;
      }
      if (hit.kind === 'chat') {
        if (hit.workspaceId && hit.workspaceId !== activeWs) {
          setActiveWorkspace(hit.workspaceId);
        }
        useUiStore.getState().setDockPanelTab('chats');
        void select(hit.id);
        setOpen(false);
        return;
      }
      if (hit.kind === 'message') {
        setPendingTimelineScroll({
          conversationId: hit.conversationId,
          eventId: hit.eventId
        });
        useUiStore.getState().setDockPanelTab('chats');
        void select(hit.conversationId);
        setOpen(false);
        return;
      }
      useUiStore.getState().setDockPanelTab('files');
      const attached = await attachDockWorkspaceFile(hit.path);
      if (attached) {
        setOpen(false);
        return;
      }
      await previewDockWorkspaceFile(hit.path);
      setOpen(false);
    },
    [
      activeWs,
      conversationId,
      select,
      setActiveWorkspace,
      setDraft,
      setOpen,
      setPendingTimelineScroll
    ]
  );

  const onEnter = () => {
    const q = queryValue.trim();
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
          value={queryValue}
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
          placeholder="Search skills, chats, messages, files…"
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
          {flat.length === 0 && !loadingFiles && !loadingMessages && filesLoadError && (
            <div className={cn(chromeNoMatchesClassName, 'py-2')}>Could not load workspace files.</div>
          )}
          {flat.length === 0 && !loadingFiles && !loadingMessages && !filesLoadError && (
            <div className={cn(chromeNoMatchesClassName, 'py-2')}>No matches.</div>
          )}
          {loadingFiles && flat.length === 0 && loadingMessages && (
            <div className={cn(chromeNoMatchesClassName, 'py-2')}>Searching…</div>
          )}
          {skills.length > 0 && (
            <SearchGroup label="Skills">
              {skills.map((hit, i) => {
                const flatIndex = i;
                return (
                  <SearchRow
                    key={hit.name}
                    active={activeIndex === flatIndex}
                    icon={<Sparkles className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />}
                    label={`/${hit.displayName}`}
                    detail={hit.description}
                    mono
                    onSelect={() => void activateHit(hit)}
                    onHover={() => setActiveIndex(flatIndex)}
                  />
                );
              })}
            </SearchGroup>
          )}
          {chats.length > 0 && (
            <SearchGroup label="Chats">
              {chats.map((hit, i) => {
                const flatIndex = skills.length + i;
                return (
                  <SearchRow
                    key={hit.id}
                    active={activeIndex === flatIndex}
                    icon={<MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />}
                    label={hit.title}
                    detail={hit.workspaceLabel}
                    onSelect={() => void activateHit(hit)}
                    onHover={() => setActiveIndex(flatIndex)}
                  />
                );
              })}
            </SearchGroup>
          )}
          {messages.length > 0 && (
            <SearchGroup label="Messages">
              {messages.map((hit, i) => {
                const flatIndex = skills.length + chats.length + i;
                return (
                  <SearchRow
                    key={`${hit.conversationId}:${hit.eventId}`}
                    active={activeIndex === flatIndex}
                    icon={<MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />}
                    label={hit.excerpt}
                    detail={hit.conversationTitle}
                    onSelect={() => void activateHit(hit)}
                    onHover={() => setActiveIndex(flatIndex)}
                  />
                );
              })}
            </SearchGroup>
          )}
          {files.length > 0 && (
            <SearchGroup label="Files">
              {files.map((hit, i) => {
                const flatIndex = skills.length + chats.length + messages.length + i;
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
  detail,
  icon,
  mono = false,
  trailing,
  active,
  onSelect,
  onHover
}: {
  label: string;
  detail?: string;
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
        active && 'bg-dock-selection'
      )}
    >
      <span className="text-text-faint">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate', mono && 'font-mono')}>{label}</span>
        {detail ? (
          <span className="block truncate text-meta text-text-faint">{detail}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}
