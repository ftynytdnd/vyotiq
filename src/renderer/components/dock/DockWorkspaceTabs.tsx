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
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { Spinner } from '../ui/Spinner.js';
import { cn } from '../../lib/cn.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useWorkspaceHasActiveRun } from '../../hooks/chat/index.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { CONV_DRAG_MIME, DOCK_HOVER_ACTIONS, DOCK_TAB_FOCUS } from './dockShared.js';
import { useUiStore } from '../../store/useUiStore.js';
import { handleDockVerticalTablistKeyDown } from './dockVerticalTablistKeyboard.js';

export function DockWorkspaceTabs() {
  const workspaces = useWorkspaceStore((s) => s.list);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const addWorkspace = useWorkspaceStore((s) => s.add);
  const loading = useWorkspaceStore((s) => s.loading);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-workspace-id="${activeId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  if (loading && workspaces.length === 0) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-row text-text-faint">
        <Spinner /> Loading workspaces…
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col gap-2 px-2 py-1">
        <span className="text-row text-text-faint">No workspaces.</span>
        <button
          type="button"
          onClick={() => void addWorkspace()}
          className={cn(
            'app-no-drag rounded-inner px-2 py-0.5 text-row text-text-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary'
          )}
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
      className="scrollbar-stealth flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1"
      onKeyDown={(e) => {
        handleDockVerticalTablistKeyDown({
          e,
          ids: workspaces.map((ws) => ws.id),
          activeId,
          onActivate: (id) => void setActive(id),
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
          onActivate={() => void setActive(ws.id)}
        />
      ))}
      <button
        type="button"
        aria-label="Add workspace"
        title="Add workspace"
        onClick={() => void addWorkspace()}
        className={cn(
          'app-no-drag inline-flex h-7 w-full shrink-0 items-center justify-center gap-1 rounded-inner',
          'text-row text-text-muted transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary'
        )}
      >
        <Plus className="h-3 w-3" strokeWidth={2.25} />
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
          'group app-no-drag flex w-full max-w-none shrink-0 items-center gap-1 rounded-inner px-2 py-1',
          'text-row transition-colors duration-150',
          DOCK_TAB_FOCUS,
          active
            ? 'bg-surface-overlay text-text-primary'
            : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary',
          hasActiveRun && 'vyotiq-shimmer-pill',
          dragOver && 'bg-surface-hover ring-1 ring-border-subtle/60'
        )}
        aria-busy={hasActiveRun || undefined}
      >
        {editing ? (
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
              className="flex min-w-0 flex-1 items-center gap-1 truncate text-left"
              title={workspace.path ?? workspace.label}
            >
              {active ? (
                <FolderOpen className="h-3 w-3 shrink-0" strokeWidth={2} />
              ) : (
                <Folder className="h-3 w-3 shrink-0" strokeWidth={2} />
              )}
              <span className="truncate">{workspace.label}</span>
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
                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-inner',
                  'text-text-faint hover:text-text-primary focus-visible:opacity-100'
                )}
              >
                {chatsCollapsed ? (
                  <ChevronDown className="h-3 w-3" strokeWidth={2.25} />
                ) : (
                  <ChevronUp className="h-3 w-3" strokeWidth={2.25} />
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
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
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
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-inner',
                  'text-text-faint hover:text-text-primary focus-visible:opacity-100'
                )}
              >
                <Pencil className="h-2.5 w-2.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label="Remove workspace"
                onClick={() => setRemoveStep('confirm')}
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-inner',
                  'text-text-faint hover:text-danger focus-visible:opacity-100'
                )}
              >
                <Trash2 className="h-2.5 w-2.5" strokeWidth={2} />
              </button>
            </span>
          </>
        )}
      </div>

      <ConfirmDialog
        open={removeStep === 'confirm'}
        title="Remove workspace?"
        message={`"${workspace.label}" will be removed from the list.`}
        confirmLabel="Continue"
        onConfirm={() => setRemoveStep('choice')}
        onCancel={() => setRemoveStep('idle')}
      />
      <ConfirmDialog
        open={removeStep === 'choice'}
        title="Delete chats too?"
        message="Keep chats (move to another workspace) or delete them permanently."
        confirmLabel="Delete chats"
        cancelLabel="Keep chats"
        variant="danger"
        onConfirm={() => {
          setRemoveStep('idle');
          void removeWorkspace(workspace.id, { deleteConversations: true });
        }}
        onCancel={() => {
          setRemoveStep('idle');
          void removeWorkspace(workspace.id, { deleteConversations: false });
        }}
      />
      <ConfirmDialog
        open={retryOpen}
        title="Retry workspace path?"
        message={`Agent V could not reach "${workspace.path}". Retry now?`}
        confirmLabel="Retry"
        onConfirm={() => {
          setRetryOpen(false);
          void retryReachability(workspace.id);
        }}
        onCancel={() => setRetryOpen(false)}
      />
    </>
  );
}
