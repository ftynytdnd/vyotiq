/**
 * Vertical workspace tabs for the left dock. Clicking a tab
 * activates that workspace; hover reveals rename/remove affordances.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import { Button } from '../ui/Button.js';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import { InlineConfirm } from '../ui/InlineConfirm.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useWorkspaceHasActiveRun } from '../../hooks/chat/index.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import {
  CONV_DRAG_MIME,
  DOCK_EMPTY_STATE_CLASS,
  DOCK_HOVER_ACTIONS,
  DOCK_TAB_ICON_CLASS,
  DOCK_TAB_ICON_STROKE,
  DOCK_TAB_LABEL_CLASS,
  DOCK_TAB_TRIGGER_CLASS,
  dockInlineActionClassName,
  dockTabRowClassName,
  dockTabActiveAttr,
  collapseDockAfterSelection
} from './dockShared.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { formatWorkspaceSpend } from '../../lib/workspaceSpend.js';
import { handleDockVerticalTablistKeyDown } from './dockVerticalTablistKeyboard.js';

export function DockWorkspaceTabs() {
  const workspaces = useWorkspaceStore((s) => s.list);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const addWorkspace = useWorkspaceStore((s) => s.add);
  const loading = useWorkspaceStore((s) => s.loading);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeSpend = useSettingsStore((s) =>
    activeId ? s.settings.ui?.workspaceSpendUsd?.[activeId] : undefined
  );
  const activeSpendLabel = formatWorkspaceSpend(activeSpend);

  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-workspace-id="${activeId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  if (loading && workspaces.length === 0) {
    return (
      <div className={cn(DOCK_EMPTY_STATE_CLASS, 'flex-row items-center')}>
        <LoadingHint message="Loading workspaces…" className="py-2" />
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className={DOCK_EMPTY_STATE_CLASS}>
        <span className="text-row text-text-faint">No workspaces.</span>
        <button
          type="button"
          onClick={() => void addWorkspace()}
          className={dockInlineActionClassName()}
        >
          Add workspace
        </button>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-label="Workspaces"
      className="scrollbar-stealth flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1.5"
      onKeyDown={(e) => {
        handleDockVerticalTablistKeyDown({
          e,
          ids: workspaces.map((ws) => ws.id),
          activeId,
          onActivate: (id) => {
            void setActive(id);
            collapseDockAfterSelection();
          },
          focusTarget: (id) =>
            scrollRef.current?.querySelector<HTMLElement>(`[data-workspace-id="${id}"]`)
        });
      }}
    >
      {workspaces.map((ws) => (
        <WorkspaceTab
          key={ws.id}
          workspace={ws}
          active={ws.id === activeId}
          onActivate={() => {
            void setActive(ws.id);
            collapseDockAfterSelection();
          }}
        />
      ))}
      {activeSpendLabel ? (
        <div
          className="px-2 py-0.5 font-mono text-meta tabular-nums text-text-faint"
          title="Vyotiq-estimated API spend for this workspace"
        >
          {activeSpendLabel}
          <span className="text-text-faint/80"> est.</span>
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Add workspace"
        title="Add workspace"
        onClick={() => void addWorkspace()}
        className="vx-btn vx-btn-quiet gap-1 self-start px-1.5 text-row"
      >
        <Plus className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
        <span>Add workspace</span>
      </button>
    </div>
  );
}

interface WorkspaceTabProps {
  workspace: WorkspaceEntry;
  active: boolean;
  onActivate: () => void;
}

function WorkspaceTab({ workspace, active, onActivate }: WorkspaceTabProps) {
  const renameWorkspace = useWorkspaceStore((s) => s.rename);
  const removeWorkspace = useWorkspaceStore((s) => s.remove);
  const retryReachability = useWorkspaceStore((s) => s.retryReachability);
  const moveConversation = useConversationsStore((s) => s.move);
  const chatsCollapsed = useUiStore((s) => s.collapsedWorkspaces.has(workspace.id));
  const toggleWorkspaceCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);
  const hasActiveRun = useWorkspaceHasActiveRun(workspace.id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.label);
  const [removeStep, setRemoveStep] = useState<'idle' | 'confirm' | 'choice'>('idle');
  const [retryOpen, setRetryOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isUnreachable = workspace.unreachable === true;

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== workspace.label) {
      void renameWorkspace(workspace.id, trimmed);
    } else {
      setDraft(workspace.label);
    }
  };

  return (
    <>
      <div
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        data-workspace-id={workspace.id}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(CONV_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const conversationId = e.dataTransfer.getData(CONV_DRAG_MIME);
          if (conversationId.length === 0) return;
          void moveConversation(conversationId, workspace.id);
        }}
        className={cn(
          dockTabRowClassName(active, 'workspace'),
          (removeStep === 'confirm' || removeStep === 'choice') &&
            'h-auto flex-col items-stretch gap-1 py-1',
          hasActiveRun && 'vyotiq-shimmer-pill',
          dragOver && 'bg-chrome-hover-strong ring-1 ring-border-subtle/70'
        )}
        data-active={dockTabActiveAttr(active)}
        aria-busy={hasActiveRun || undefined}
      >
        {removeStep === 'confirm' ? (
          <div className="mx-1 my-0.5 w-[calc(100%-0.5rem)]">
            <DestructiveConfirm
              variant="inline"
              open
              twoStep={false}
              context={workspace.label}
              question="Remove this workspace?"
              confirmLabel="Continue"
              cancelLabel="Cancel"
              className="vx-inline-confirm--stacked flex-col items-stretch gap-1.5 rounded-inner border border-border-subtle/30 bg-surface-overlay/40 p-2"
              onConfirm={() => setRemoveStep('choice')}
              onCancel={() => setRemoveStep('idle')}
            />
          </div>
        ) : removeStep === 'choice' ? (
          <WorkspaceRemoveChoice
            label={workspace.label}
            onCancel={() => setRemoveStep('idle')}
            onKeepChats={() => {
              setRemoveStep('idle');
              void removeWorkspace(workspace.id, { deleteConversations: false });
            }}
            onDeleteChats={() => {
              setRemoveStep('idle');
              void removeWorkspace(workspace.id, { deleteConversations: true });
            }}
          />
        ) : retryOpen ? (
          <InlineConfirm
            context={workspace.label}
            question="Retry path?"
            confirmLabel="Retry"
            variant="primary"
            onConfirm={() => {
              setRetryOpen(false);
              void retryReachability(workspace.id);
            }}
            onCancel={() => setRetryOpen(false)}
          />
        ) : editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(workspace.label);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-row outline-none"
            aria-label="Rename workspace"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={onActivate}
              className={DOCK_TAB_TRIGGER_CLASS}
              title={workspace.path ?? workspace.label}
            >
              {active ? (
                <FolderOpen className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
              ) : (
                <Folder className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} />
              )}
              <span className={DOCK_TAB_LABEL_CLASS}>{workspace.label}</span>
            </button>
            {active && (
              <button
                type="button"
                aria-label={chatsCollapsed ? 'Expand chats' : 'Collapse chats'}
                title={chatsCollapsed ? 'Expand chats' : 'Collapse chats'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWorkspaceCollapsed(workspace.id);
                }}
                className={cn(
                  'vx-btn vx-btn-quiet inline-flex h-4 w-4 items-center justify-center px-0',
                  'text-text-faint hover:text-text-primary focus-visible:opacity-100'
                )}
              >
                {chatsCollapsed ? (
                  <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                ) : (
                  <ChevronUp className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
                )}
              </button>
            )}
            {isUnreachable && (
              <button
                type="button"
                aria-label="Workspace unreachable"
                title="Path unreachable — click to retry"
                onClick={() => setRetryOpen(true)}
                className="shrink-0 text-warning focus-visible:opacity-100"
              >
                <AlertTriangle className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              </button>
            )}
            <span className={cn('flex shrink-0 items-center gap-0.5', DOCK_HOVER_ACTIONS)}>
              <button
                type="button"
                aria-label="Rename workspace"
                onClick={() => {
                  setEditing(true);
                  queueMicrotask(() => inputRef.current?.select());
                }}
                className="vx-btn vx-btn-quiet inline-flex h-4 w-4 items-center justify-center px-0 text-text-faint hover:text-text-primary focus-visible:opacity-100"
              >
                <Pencil className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              </button>
              <button
                type="button"
                aria-label="Remove workspace"
                onClick={() => setRemoveStep('confirm')}
                className="vx-btn vx-btn-quiet inline-flex h-4 w-4 items-center justify-center px-0 text-text-faint hover:text-danger focus-visible:opacity-100"
              >
                <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
              </button>
            </span>
          </>
        )}
      </div>

    </>
  );
}

interface WorkspaceRemoveChoiceProps {
  label: string;
  onCancel: () => void;
  onKeepChats: () => void;
  onDeleteChats: () => void;
}

function WorkspaceRemoveChoice({
  label,
  onCancel,
  onKeepChats,
  onDeleteChats
}: WorkspaceRemoveChoiceProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={`Choose how to remove ${label}`}
      data-inline-confirm="true"
      className="vx-inline-confirm vx-inline-confirm--stacked mx-1 my-0.5 w-[calc(100%-0.5rem)] rounded-inner border border-border-subtle/30 bg-surface-overlay/40 p-2"
    >
      <span className="text-row text-text-secondary">Delete chats in “{label}” too?</span>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="secondary" onClick={onKeepChats}>
          Keep chats
        </Button>
        <Button size="sm" variant="danger" onClick={onDeleteChats}>
          Delete chats
        </Button>
      </div>
    </div>
  );
}
