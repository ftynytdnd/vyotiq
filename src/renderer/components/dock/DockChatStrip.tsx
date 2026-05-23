/**
 * Vertical chat strip for the left dock. Each conversation renders
 * as a compact pill; the active chat is highlighted. Registers refs
 * via `useChatRowFocus` so the composer's "running elsewhere" hint
 * can scroll to a tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ConversationMeta } from '@shared/types/chat.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { Spinner } from '../ui/Spinner.js';
import { cn } from '../../lib/cn.js';
import { DockChatMoveMenu } from './DockChatMoveMenu.js';
import { filterDockChats } from './filterDockChats.js';
import {
  CONV_DRAG_MIME,
  DOCK_HOVER_ACTIONS,
  DOCK_TAB_FOCUS
} from './dockShared.js';
import { useConversationProcessing } from '../../hooks/chat/index.js';
import { PeakContextBadge } from '../chat/PeakContextBadge.js';
import { useChatRowFocus } from '../../hooks/chat/index.js';
import { RunningTitle, RunStopButton } from '../runIndicators/index.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { buildDisplayChatTitles } from './displayChatTitles.js';
import { handleDockVerticalTablistKeyDown } from './dockVerticalTablistKeyboard.js';
import { useShallow } from 'zustand/react/shallow';

interface DockChatStripProps {
  workspaceId: string | null;
}

export function DockChatStrip({ workspaceId }: DockChatStripProps) {
  const list = useConversationsStore((s) => s.list);
  const loading = useConversationsStore((s) => s.loading);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const select = useConversationsStore((s) => s.select);
  const prewarm = useConversationsStore((s) => s.prewarm);
  const rename = useConversationsStore((s) => s.rename);
  const remove = useConversationsStore((s) => s.remove);
  const newConversationFor = useConversationsStore((s) => s.newConversationFor);

  const query = useDockSearchStore((s) => s.query);
  const searchOpen = useDockSearchStore((s) => s.open);

  const runningIds = useChatStore(
    useShallow((s) => {
      const set = new Set<string>();
      for (const [id, slice] of Object.entries(s.slices)) {
        if (slice.isProcessing) set.add(id);
      }
      return set;
    })
  );

  const entries = useMemo(() => {
    if (!workspaceId) return [];
    return filterDockChats(
      list,
      workspaceId,
      query,
      searchOpen,
      runningIds,
      activeIdByWorkspace[workspaceId] ?? null
    );
  }, [list, workspaceId, query, searchOpen, runningIds, activeIdByWorkspace]);

  const activeId = workspaceId ? activeIdByWorkspace[workspaceId] ?? null : null;
  const isFiltering = searchOpen && query.trim().length > 0;
  const displayTitles = useMemo(() => buildDisplayChatTitles(entries), [entries]);
  const chatsCollapsed = useUiStore(
    (s) => (workspaceId ? s.collapsedWorkspaces.has(workspaceId) : false)
  );
  const toggleWorkspaceCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate peak-context badges for visible tabs without requiring
  // the user to open each chat first.
  useEffect(() => {
    for (const entry of entries) {
      void prewarm(entry.id);
    }
  }, [entries, prewarm]);

  // Keep the active tab visible when selection changes.
  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-conv-id="${activeId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  if (!workspaceId) {
    return (
      <div className="flex flex-1 flex-col px-2 py-1 text-row text-text-faint">
        Open a workspace to see chats.
      </div>
    );
  }

  if (loading && list.length === 0) {
    return (
      <div className="flex flex-1 items-center gap-2 px-2 py-1 text-row text-text-faint">
        <Spinner /> Loading…
      </div>
    );
  }

  if (chatsCollapsed) {
    const count = entries.length;
    const runningEntries = entries.filter((e) => runningIds.has(e.id));
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 py-1">
        {runningEntries.map((runningEntry) => {
          const runningRunId = useChatStore.getState().slices[runningEntry.id]?.runId;
          if (!runningRunId) return null;
          return (
            <div key={runningEntry.id} className="flex min-w-0 items-center gap-1">
              <ChatTab
                entry={runningEntry}
                displayTitle={displayTitles.get(runningEntry.id) ?? runningEntry.title}
                active={runningEntry.id === activeId}
                onSelect={() => void select(runningEntry.id)}
                onRename={(title) => void rename(runningEntry.id, title)}
                onRemove={() => void remove(runningEntry.id)}
              />
              <RunStopButton
                runId={runningRunId}
                conversationTitle={displayTitles.get(runningEntry.id) ?? runningEntry.title}
              />
            </div>
          );
        })}
        <span className="text-row text-text-faint">
          {count === 0 ? 'No chats' : `${count} chat${count === 1 ? '' : 's'} hidden`}
        </span>
        <button
          type="button"
          onClick={() => workspaceId && toggleWorkspaceCollapsed(workspaceId)}
          className={cn(
            'app-no-drag rounded-inner px-2 py-0.5 text-row text-text-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary'
          )}
        >
          Expand
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 py-1">
        <span className="text-row text-text-faint">
          {isFiltering ? 'No matches.' : 'No chats yet.'}
        </span>
        {!isFiltering && (
          <button
            type="button"
            onClick={() => void newConversationFor(workspaceId)}
            className={cn(
              'app-no-drag rounded-inner px-2 py-0.5 text-row text-text-muted',
              'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary'
            )}
          >
            New chat
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-label="Chats in workspace"
      className="scrollbar-stealth flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1"
      onKeyDown={(e) => {
        handleDockVerticalTablistKeyDown({
          e,
          ids: entries.map((entry) => entry.id),
          activeId,
          onActivate: (id) => void select(id),
          focusTarget: (id) =>
            scrollRef.current?.querySelector<HTMLElement>(`[data-conv-id="${id}"]`)
        });
      }}
    >
      {entries.map((entry) => (
        <ChatTab
          key={entry.id}
          entry={entry}
          displayTitle={displayTitles.get(entry.id) ?? entry.title}
          active={entry.id === activeId}
          onSelect={() => void select(entry.id)}
          onRename={(title) => void rename(entry.id, title)}
          onRemove={() => void remove(entry.id)}
        />
      ))}
    </div>
  );
}

interface ChatTabProps {
  entry: ConversationMeta;
  displayTitle: string;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}

function ChatTab({ entry, displayTitle, active, onSelect, onRename, onRemove }: ChatTabProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isProcessing, runId } = useConversationProcessing(entry.id);
  const registerRowRef = useChatRowFocus(entry.id);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(entry.title);
  }, [entry.title, editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== entry.title) onRename(trimmed);
    else setDraft(entry.title);
  };

  return (
    <>
      <div
        ref={registerRowRef}
        data-conv-id={entry.id}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        draggable={!editing && !isProcessing}
        onDragStart={(e) => {
          e.dataTransfer.setData(CONV_DRAG_MIME, entry.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className={cn(
          'group app-no-drag flex w-full max-w-none shrink-0 items-center gap-1 rounded-inner px-2 py-1',
          'text-row transition-colors duration-150',
          DOCK_TAB_FOCUS,
          active
            ? 'bg-surface-overlay text-text-primary'
            : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary'
        )}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(entry.title);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-row text-text-primary outline-none"
            aria-label="Rename chat"
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={(e) => {
              e.preventDefault();
              setEditing(true);
            }}
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
            title={displayTitle}
          >
            {isProcessing ? (
              <RunningTitle id={entry.id} title={displayTitle} />
            ) : (
              displayTitle
            )}
            {!editing && <PeakContextBadge meta={entry} className="ml-1" />}
          </button>
        )}
        {!editing && (
          <span className={cn('flex shrink-0 items-center', DOCK_HOVER_ACTIONS)}>
            {isProcessing && runId ? (
              <RunStopButton runId={runId} conversationTitle={entry.title} />
            ) : (
              <>
                {entry.workspaceId && (
                  <DockChatMoveMenu
                    conversationId={entry.id}
                    currentWorkspaceId={entry.workspaceId}
                  />
                )}
                <button
                  type="button"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteOpen(true);
                  }}
                  className={cn(
                    'inline-flex h-4 w-4 items-center justify-center rounded-inner',
                    'text-text-faint hover:text-danger focus-visible:opacity-100'
                  )}
                >
                  <Trash2 className="h-3 w-3" strokeWidth={2} />
                </button>
              </>
            )}
          </span>
        )}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title="Delete chat?"
        message={`"${entry.title}" will be removed permanently.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setDeleteOpen(false);
          onRemove();
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}

