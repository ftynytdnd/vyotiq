/**
 * Vertical chat strip for the left dock. Each conversation renders
 * as a compact pill; the active chat is highlighted. Registers refs
 * via `useChatRowFocus` so the composer's "running elsewhere" hint
 * can scroll to a tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Download, Plus, Trash2, MessageSquare } from 'lucide-react';
import type { ConversationMeta } from '@shared/types/chat.js';
import { Button } from '../ui/Button.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { DockChatMoveMenu } from './DockChatMoveMenu.js';
import { filterDockChats } from './filterDockChats.js';
import { chromeNoMatchesClassName, chromePillClassName } from '../ui/SurfaceShell.js';
import {
  CONV_DRAG_MIME,
  DOCK_TAB_ICON_CLASS,
  DOCK_TAB_ICON_STROKE,
  DOCK_CHAT_TAB_INNER_CLASS,
  DOCK_CHAT_TAB_STACK_CLASS,
  DOCK_EMPTY_STATE_CLASS,
  DOCK_HOVER_ACTIONS,
  DOCK_TAB_LABEL_CLASS,
  DOCK_TAB_TRIGGER_CLASS,
  dockInlineActionClassName,
  dockTabRowClassName,
  dockTabActiveAttr,
  dismissDockSearchAfterSelection
} from './dockShared.js';
import { useConversationProcessing } from '../../hooks/chat/index.js';
import { useChatRowFocus } from '../../hooks/chat/index.js';
import { BackgroundRunsBadge, RunningTitle, RunStopButton } from '../runIndicators/index.js';
import { runningChatIdsFromSlices } from './collectRunningChatIds.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { formatConversationSpend } from '../../lib/workspaceSpend.js';
import { buildDisplayChatTitles } from './displayChatTitles.js';
import { handleDockVerticalTablistKeyDown } from './dockVerticalTablistKeyboard.js';
import { formatRelativeTime } from '../../lib/formatRelativeTime.js';
import { useShallow } from 'zustand/react/shallow';

const CHAT_PAGE_SIZE = 8;

interface DockChatStripProps {
  workspaceId: string | null;
  /** Nested under a workspace folder in the navigator tree. */
  nested?: boolean;
}

export function DockChatStrip({ workspaceId, nested = false }: DockChatStripProps) {
  const list = useConversationsStore((s) => s.list);
  const loading = useConversationsStore((s) => s.loading);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const select = useConversationsStore((s) => s.select);
  const prewarm = useConversationsStore((s) => s.prewarm);
  const rename = useConversationsStore((s) => s.rename);
  const remove = useConversationsStore((s) => s.remove);
  const archive = useConversationsStore((s) => s.archive);
  const unarchive = useConversationsStore((s) => s.unarchive);
  const newConversationFor = useConversationsStore((s) => s.newConversationFor);

  const query = useDockSearchStore((s) => s.query);
  const searchOpen = useDockSearchStore((s) => s.open);

  const runningIds = useChatStore(
    useShallow((s) => runningChatIdsFromSlices(s.slices))
  );

  const entries = useMemo(() => {
    if (!workspaceId) return [];
    return filterDockChats(
      list,
      workspaceId,
      query,
      searchOpen,
      runningIds,
      activeIdByWorkspace[workspaceId] ?? null,
      { archivedOnly: false }
    );
  }, [list, workspaceId, query, searchOpen, runningIds, activeIdByWorkspace]);

  const archivedEntries = useMemo(() => {
    if (!workspaceId) return [];
    return filterDockChats(
      list,
      workspaceId,
      query,
      searchOpen,
      runningIds,
      activeIdByWorkspace[workspaceId] ?? null,
      { archivedOnly: true }
    );
  }, [list, workspaceId, query, searchOpen, runningIds, activeIdByWorkspace]);

  const activeId = workspaceId ? activeIdByWorkspace[workspaceId] ?? null : null;
  const selectChat = (id: string) => {
    void select(id);
    dismissDockSearchAfterSelection();
  };
  const isFiltering = searchOpen && query.trim().length > 0;
  const displayTitles = useMemo(() => buildDisplayChatTitles(entries), [entries]);
  const chatsCollapsed = useUiStore(
    (s) => (workspaceId ? s.collapsedWorkspaces.has(workspaceId) : false)
  );
  const toggleWorkspaceCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [chatLimit, setChatLimit] = useState(CHAT_PAGE_SIZE);

  useEffect(() => {
    setChatLimit(CHAT_PAGE_SIZE);
  }, [workspaceId]);

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
      <div className={cn(DOCK_EMPTY_STATE_CLASS, 'flex-1')}>
        <MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
        <span>Open a workspace to see chats.</span>
      </div>
    );
  }

  if (loading && list.length === 0) {
    return (
      <div className={cn(DOCK_EMPTY_STATE_CLASS, 'flex-1')}>
        <LoadingHint message="Loading…" className="py-4" />
      </div>
    );
  }

  if (chatsCollapsed) {
    const count = entries.length;
    const runningEntries = entries.filter((e) => runningIds.has(e.id));
    return (
      <div className={cn(DOCK_EMPTY_STATE_CLASS, 'min-h-0 flex-1')}>
        {runningEntries.map((runningEntry) => {
          const runningRunId = useChatStore.getState().slices[runningEntry.id]?.runId;
          if (!runningRunId) return null;
          return (
            <div key={runningEntry.id} className="flex min-w-0 items-center gap-1">
              <ChatTab
                entry={runningEntry}
                displayTitle={displayTitles.get(runningEntry.id) ?? runningEntry.title}
                active={runningEntry.id === activeId}
                onSelect={() => selectChat(runningEntry.id)}
                onRename={(title) => void rename(runningEntry.id, title)}
                onRemove={() => void remove(runningEntry.id)}
                onArchive={() => void archive(runningEntry.id)}
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
          className={dockInlineActionClassName()}
        >
          Expand
        </button>
      </div>
    );
  }

  if (entries.length === 0) {
    if (nested) {
      return (
        <p className="vx-dock-session-empty text-meta text-text-faint">
          {isFiltering ? 'No matches.' : 'No chats yet.'}
        </p>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DockChatChrome onNewChat={() => void newConversationFor(workspaceId)} disabled={isFiltering} />
        <div className={cn(DOCK_EMPTY_STATE_CLASS, 'min-h-0 flex-1')}>
          {isFiltering ? (
            <span className={chromeNoMatchesClassName}>No matches.</span>
          ) : (
            <>
              <MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
              <span>No chats yet.</span>
            </>
          )}
        </div>
      </div>
    );
  }

  const visibleEntries = nested ? entries.slice(0, chatLimit) : entries;
  const hiddenCount = nested ? Math.max(0, entries.length - chatLimit) : 0;

  return (
    <div
      className={cn(
        nested ? 'vx-dock-session-list' : 'flex min-h-0 flex-1 flex-col overflow-hidden'
      )}
    >
      {!nested ? <DockChatChrome onNewChat={() => void newConversationFor(workspaceId)} /> : null}
      <div
        ref={scrollRef}
        role="tablist"
        aria-label="Chats in workspace"
        className={cn(
          nested
            ? 'vx-dock-session-list min-w-0'
            : 'scrollbar-stealth flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1.5 pt-0.5'
        )}
      onKeyDown={(e) => {
        handleDockVerticalTablistKeyDown({
          e,
          ids: entries.map((entry) => entry.id),
          activeId,
          onActivate: (id) => selectChat(id),
          focusTarget: (id) =>
            scrollRef.current?.querySelector<HTMLElement>(`[data-conv-id="${id}"]`)
        });
      }}
    >
      <BackgroundRunsBadge />
      {visibleEntries.map((entry) => (
        <ChatTab
          key={entry.id}
          entry={entry}
          displayTitle={displayTitles.get(entry.id) ?? entry.title}
          active={entry.id === activeId}
          nested={nested}
          onSelect={() => selectChat(entry.id)}
          onRename={(title) => void rename(entry.id, title)}
          onRemove={() => void remove(entry.id)}
          onArchive={() => void archive(entry.id)}
        />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="vx-dock-session-more text-left text-meta text-text-faint hover:text-text-secondary"
          onClick={() => setChatLimit((limit) => limit + CHAT_PAGE_SIZE)}
        >
          More
        </button>
      ) : null}
      {archivedEntries.length > 0 && (
        <div className="mt-2 border-t border-border-subtle/30 pt-2">
          <button
            type="button"
            onClick={() => setArchivedExpanded((open) => !open)}
            className="flex w-full items-center gap-1 px-2 pb-1 text-left text-meta font-medium text-text-faint hover:text-text-secondary"
            aria-expanded={archivedExpanded}
          >
            {archivedExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span>Archived ({archivedEntries.length})</span>
          </button>
          {archivedExpanded &&
            archivedEntries.map((entry) => (
              <ChatTab
                key={entry.id}
                entry={entry}
                displayTitle={displayTitles.get(entry.id) ?? entry.title}
                active={entry.id === activeId}
                archived
                onSelect={() => selectChat(entry.id)}
                onRename={(title) => void rename(entry.id, title)}
                onRemove={() => void remove(entry.id)}
                onArchive={() => void unarchive(entry.id)}
              />
            ))}
        </div>
      )}
      </div>
    </div>
  );
}

function DockChatChrome({
  onNewChat,
  disabled = false
}: {
  onNewChat: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="vx-dock-chat-chrome shrink-0 border-b border-border-subtle/25 px-1.5 py-1">
      <button
        type="button"
        className={cn(chromePillClassName(), 'gap-1 text-row')}
        onClick={onNewChat}
        disabled={disabled}
        aria-label="New chat"
      >
        <Plus className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
        <span>New chat</span>
      </button>
    </div>
  );
}

interface ChatTabProps {
  entry: ConversationMeta;
  displayTitle: string;
  active: boolean;
  archived?: boolean;
  nested?: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  onArchive: () => void;
}

function ChatTab({
  entry,
  displayTitle,
  active,
  archived = false,
  nested = false,
  onSelect,
  onRename,
  onRemove,
  onArchive
}: ChatTabProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const deleteOpenRef = useRef(false);
  const lastTrashClickRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isRunActive, runId } = useConversationProcessing(entry.id);
  const registerRowRef = useChatRowFocus(entry.id);
  const showToast = useToastStore((s) => s.show);

  const onExport = async (format: 'jsonl' | 'markdown') => {
    setExportOpen(false);
    try {
      const result = await vyotiq.conversations.export(entry.id, format);
      if (result.canceled) return;
      showToast('Transcript exported', 'success');
    } catch {
      showToast('Export failed', 'danger');
    }
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(entry.title);
  }, [entry.title, editing]);

  useEffect(() => {
    deleteOpenRef.current = deleteOpen;
  }, [deleteOpen]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== entry.title) onRename(trimmed);
    else setDraft(entry.title);
  };

  const spendLabel = formatConversationSpend(entry.estimatedSpendUsd);
  const tabTitle = spendLabel ? `${displayTitle} · ${spendLabel} est.` : displayTitle;
  const timeLabel = formatRelativeTime(entry.updatedAt);

  return (
    <>
      <div
        ref={registerRowRef}
        data-conv-id={entry.id}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        draggable={!editing && !isRunActive && !deleteOpen}
        onDragStart={(e) => {
          e.dataTransfer.setData(CONV_DRAG_MIME, entry.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        className={cn(
          dockTabRowClassName(active, 'chat'),
          nested ? 'vx-dock-session-row' : DOCK_CHAT_TAB_STACK_CLASS
        )}
        data-active={dockTabActiveAttr(active)}
      >
        <div className={cn(DOCK_CHAT_TAB_INNER_CLASS, nested && 'gap-1.5')}>
          {deleteOpen ? (
            <DestructiveConfirm
              variant="inline"
              open
              context={displayTitle}
              question={
                isRunActive
                  ? 'Remove this chat? A run is still active in it.'
                  : 'Remove this chat?'
              }
              confirmLabel="Delete"
              onConfirm={() => {
                setDeleteOpen(false);
                onRemove();
              }}
              onCancel={() => setDeleteOpen(false)}
            />
          ) : editing ? (
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
            <>
              {nested && isRunActive ? (
                <span className="vx-dock-session-dot shrink-0" aria-hidden />
              ) : null}
              <button
                type="button"
                onClick={onSelect}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setEditing(true);
                }}
                className={cn(
                  DOCK_TAB_TRIGGER_CLASS,
                  nested ? 'vx-dock-session-trigger min-w-0 flex-1' : undefined
                )}
                title={tabTitle}
              >
                {nested ? (
                  <>
                    {isRunActive ? (
                      <RunningTitle
                        id={entry.id}
                        title={displayTitle}
                        className="vx-dock-session-title"
                      />
                    ) : (
                      <span className="vx-dock-session-title">{displayTitle}</span>
                    )}
                    <span className="vx-dock-session-time">{timeLabel}</span>
                  </>
                ) : isRunActive ? (
                  <RunningTitle id={entry.id} title={displayTitle} className={DOCK_TAB_LABEL_CLASS} />
                ) : (
                  <span className="inline-flex min-w-0 items-baseline gap-1">
                    <span className={cn(DOCK_TAB_LABEL_CLASS, 'min-w-0 truncate')}>
                      {displayTitle}
                    </span>
                    {spendLabel ? (
                      <span className="shrink-0 font-mono text-meta tabular-nums text-text-faint">
                        {spendLabel}
                      </span>
                    ) : null}
                  </span>
                )}
              </button>
            </>
          )}
          {!editing && !deleteOpen ? (
            <span className={cn('flex shrink-0 items-center', DOCK_HOVER_ACTIONS)}>
              {isRunActive && runId ? (
                <RunStopButton runId={runId} conversationTitle={entry.title} />
              ) : nested ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={archived ? 'Restore chat' : 'Archive chat'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive();
                    }}
                    className="h-4 w-4 px-0 text-text-faint hover:text-text-secondary"
                  >
                    {archived ? (
                      <ArchiveRestore
                        className={SHELL_ROW_ICON_CLASS}
                        strokeWidth={SHELL_ACTION_ICON_STROKE}
                      />
                    ) : (
                      <Archive
                        className={SHELL_ROW_ICON_CLASS}
                        strokeWidth={SHELL_ACTION_ICON_STROKE}
                      />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      const now = Date.now();
                      if (now - lastTrashClickRef.current < 400) return;
                      lastTrashClickRef.current = now;
                      if (deleteOpenRef.current) return;
                      setDeleteOpen(true);
                    }}
                    className="h-4 w-4 px-0 text-text-faint hover:text-danger"
                  >
                    <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                  </Button>
                </>
              ) : (
                <>
                  {entry.workspaceId && (
                    <DockChatMoveMenu
                      conversationId={entry.id}
                      currentWorkspaceId={entry.workspaceId}
                    />
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Export transcript"
                    aria-expanded={exportOpen}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExportOpen((open) => !open);
                    }}
                    className="h-4 w-4 px-0 text-text-faint hover:text-text-secondary"
                  >
                    <Download className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                  </Button>
                  {exportOpen ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Export as Markdown"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onExport('markdown');
                        }}
                        className="h-4 px-1 text-meta text-text-faint hover:text-text-secondary"
                      >
                        MD
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Export as JSONL"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onExport('jsonl');
                        }}
                        className="h-4 px-1 text-meta text-text-faint hover:text-text-secondary"
                      >
                        JL
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={archived ? 'Restore chat' : 'Archive chat'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive();
                    }}
                    className="h-4 w-4 px-0 text-text-faint hover:text-text-secondary"
                  >
                    {archived ? (
                      <ArchiveRestore className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                    ) : (
                      <Archive className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation();
                      const now = Date.now();
                      if (now - lastTrashClickRef.current < 400) return;
                      lastTrashClickRef.current = now;
                      if (deleteOpenRef.current) return;
                      setDeleteOpen(true);
                    }}
                    className="h-4 w-4 px-0 text-text-faint hover:text-danger"
                  >
                    <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                  </Button>
                </>
              )}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
