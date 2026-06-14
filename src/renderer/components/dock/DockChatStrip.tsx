/**
 * Vertical chat strip for the left dock. Each conversation renders
 * as a compact pill; the active chat is highlighted. Registers refs
 * via `useChatRowFocus` so the composer's "running elsewhere" hint
 * can scroll to a tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Download, Trash2, MessageSquare } from 'lucide-react';
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
import { chromeNoMatchesClassName } from '../ui/SurfaceShell.js';
import {
  CONV_DRAG_MIME,
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
    useUiStore.getState().setDockPanelTab('chats');
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
    return (
      <div className={cn(DOCK_EMPTY_STATE_CLASS, 'min-h-0 flex-1')}>
        {isFiltering ? (
          <span className={chromeNoMatchesClassName}>No matches.</span>
        ) : (
          <>
            <MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
            <span>No chats yet.</span>
          </>
        )}
        {!isFiltering && (
          <button
            type="button"
            onClick={() => void newConversationFor(workspaceId)}
            className={dockInlineActionClassName()}
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
      className="scrollbar-stealth flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1.5"
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
      {entries.map((entry) => (
        <ChatTab
          key={entry.id}
          entry={entry}
          displayTitle={displayTitles.get(entry.id) ?? entry.title}
          active={entry.id === activeId}
          onSelect={() => selectChat(entry.id)}
          onRename={(title) => void rename(entry.id, title)}
          onRemove={() => void remove(entry.id)}
          onArchive={() => void archive(entry.id)}
        />
      ))}
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
  );
}

interface ChatTabProps {
  entry: ConversationMeta;
  displayTitle: string;
  active: boolean;
  archived?: boolean;
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
          DOCK_CHAT_TAB_STACK_CLASS
        )}
        data-active={dockTabActiveAttr(active)}
      >
        <div className={DOCK_CHAT_TAB_INNER_CLASS}>
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
              <button
                type="button"
                onClick={onSelect}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  setEditing(true);
                }}
                className={DOCK_TAB_TRIGGER_CLASS}
                title={tabTitle}
              >
                {isRunActive ? (
                  <RunningTitle id={entry.id} title={displayTitle} className={DOCK_TAB_LABEL_CLASS} />
                ) : (
                  <span className={cn(DOCK_TAB_LABEL_CLASS, 'inline-flex min-w-0 items-baseline gap-1')}>
                    <span className="min-w-0 truncate">{displayTitle}</span>
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
          {!editing && !deleteOpen && (
            <span className={cn('flex shrink-0 items-center', DOCK_HOVER_ACTIONS)}>
              {isRunActive && runId ? (
                <RunStopButton runId={runId} conversationTitle={entry.title} />
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
          )}
        </div>
      </div>
    </>
  );
}
