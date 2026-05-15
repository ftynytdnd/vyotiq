/**
 * ChatsSection — workspaces tree.
 *
 * Each workspace renders as a collapsible group whose header reuses the
 * existing `Chats` eyebrow rhythm (`text-meta font-medium uppercase
 * tracking-wider text-text-faint`) and whose body is a `ChatHistoryList`
 * filtered to that workspace's conversations. Clicking a group's header
 * activates it (`workspace.setActive`); clicking its chevron toggles
 * expand/collapse (persisted via `useUiStore.collapsedWorkspaces`).
 *
 * Search behaviour:
 *   - Empty query → all workspace groups visible, all conversations
 *     listed under their group.
 *   - Active query → conversation rows filter case-insensitively;
 *     groups stay visible only when they contain at least one match.
 *     This matches the plan: search is global, but visibility hides
 *     irrelevant groups so the user isn't drowning in headers.
 *
 * Hover affordances on group headers (rename, remove) reuse the same
 * `opacity-0 group-hover:opacity-60` pattern as the trash icon in
 * `ChatHistoryList`. No new tokens.
 *
 * Scrollable region uses the `.scrollbar-stealth` utility so the
 * scrollbar matches the sidebar's stealth aesthetic.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderX,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react';
import type { ConversationMeta } from '@shared/types/chat.js';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import { ChatHistoryList, CONV_DRAG_MIME } from './ChatHistoryList.js';
import { Spinner } from '../ui/Spinner.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useSidebarSearchStore } from '../../store/useSidebarSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useWorkspaceHasActiveRun } from '../../hooks/chat/index.js';
import { cn } from '../../lib/cn.js';
import { useShallow } from 'zustand/react/shallow';

interface ChatsSectionProps {
  /** Forwarded onto the scrollable list container so the footer can observe
   *  overflow and paint its scroll-shadow border conditionally. */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function ChatsSection({ scrollRef }: ChatsSectionProps = {}) {
  const list = useConversationsStore((s) => s.list);
  const loading = useConversationsStore((s) => s.loading);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const select = useConversationsStore((s) => s.select);
  const rename = useConversationsStore((s) => s.rename);
  const remove = useConversationsStore((s) => s.remove);
  const move = useConversationsStore((s) => s.move);
  const newConversationFor = useConversationsStore((s) => s.newConversationFor);

  const workspaces = useWorkspaceStore((s) => s.list);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActive);
  const renameWorkspace = useWorkspaceStore((s) => s.rename);
  const removeWorkspace = useWorkspaceStore((s) => s.remove);
  const addWorkspace = useWorkspaceStore((s) => s.add);
  const retryReachability = useWorkspaceStore((s) => s.retryReachability);

  const collapsed = useUiStore((s) => s.collapsedWorkspaces);
  const toggleCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);

  const query = useSidebarSearchStore((s) => s.query);
  const searchOpen = useSidebarSearchStore((s) => s.open);

  // Set of conversation ids whose slice is currently processing. Used
  // ONLY by the search-filter exception below — a conversation that
  // is actively streaming should never be hidden by an unrelated
  // query (otherwise the user can't see the run, abort it, or scroll
  // to it from the composer's "running elsewhere" hint). Subscribed
  // with `useShallow` so set-membership transitions — not every
  // streaming token — drive a re-render.
  const runningIds = useChatStore(
    useShallow((s) => {
      const set = new Set<string>();
      for (const [id, slice] of Object.entries(s.slices)) {
        if (slice.isProcessing) set.add(id);
      }
      return set;
    })
  );

  // Group conversations by workspaceId. Filtered (in search mode) or
  // not, the entries always live under their own group — there is no
  // ungrouped fallback here because the migration on main guarantees
  // every meta has a `workspaceId` after the first boot.
  //
  // In search mode, an entry is included when it matches the filter
  // OR when its slice is processing — see `runningIds` rationale
  // above.
  const filteredByWorkspace = useMemo(() => {
    const q = query.trim().toLowerCase();
    const isFiltering = searchOpen && q.length > 0;
    const result: Record<string, ConversationMeta[]> = {};
    for (const ws of workspaces) result[ws.id] = [];
    for (const meta of list) {
      const wsId = meta.workspaceId;
      if (!wsId || !result[wsId]) continue;
      if (
        isFiltering &&
        !meta.title.toLowerCase().includes(q) &&
        !runningIds.has(meta.id)
      ) {
        continue;
      }
      result[wsId]!.push(meta);
    }
    return result;
  }, [list, workspaces, query, searchOpen, runningIds]);

  const isFiltering = searchOpen && query.trim().length > 0;
  const empty = list.length === 0 && workspaces.length === 0;
  // Only surface the loading row when we truly have no cached list yet.
  // After the first resolve, subsequent refreshes happen in-place and
  // shouldn't flicker the UI back to a spinner.
  const showLoading = loading && list.length === 0 && workspaces.length === 0;

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1">
        <Eyebrow as="span" bold>
          Workspaces
        </Eyebrow>
        <button
          type="button"
          aria-label="Add workspace"
          title="Add workspace"
          onClick={() => void addWorkspace()}
          className={cn(
            'app-no-drag inline-flex h-4 w-4 items-center justify-center rounded',
            'text-text-faint transition-colors duration-150',
            'hover:bg-surface-hover hover:text-text-primary'
          )}
        >
          <Plus className="h-3 w-3" strokeWidth={2.25} />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-stealth chats-scroll min-h-0 flex-1 overflow-y-auto px-2"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0, black 8px, black calc(100% - 8px), transparent 100%)'
        }}
      >
        {empty ? (
          showLoading ? (
            <div className="flex items-center gap-2 px-2.5 py-3 text-row text-text-faint">
              <Spinner size={12} /> Loading…
            </div>
          ) : (
            <div className="px-2.5 py-3 text-row text-text-faint">
              No workspaces. Add one to begin.
            </div>
          )
        ) : (
          workspaces.map((ws) => {
            const entries = filteredByWorkspace[ws.id] ?? [];
            // In search mode, hide groups with zero matches so the user
            // isn't visually drowning in empty headers. When NOT in
            // search mode, every group stays visible (even when empty)
            // so the user can still see their workspace structure.
            if (isFiltering && entries.length === 0) return null;
            return (
              <WorkspaceGroup
                key={ws.id}
                workspace={ws}
                entries={entries}
                active={ws.id === activeWorkspaceId}
                activeConversationId={
                  ws.id === activeWorkspaceId ? activeIdByWorkspace[ws.id] ?? null : null
                }
                collapsed={collapsed.has(ws.id)}
                isFiltering={isFiltering}
                onActivate={() => void setActiveWorkspace(ws.id)}
                onToggleCollapsed={() => toggleCollapsed(ws.id)}
                onRenameWorkspace={(label) => void renameWorkspace(ws.id, label)}
                onRemoveWorkspace={removeWorkspace}
                onNewChat={() => void newConversationFor(ws.id)}
                onRetryReachability={() => void retryReachability(ws.id)}
                onSelect={(id) => void select(id)}
                onRename={(id, title) => void rename(id, title)}
                onRemove={(id) => void remove(id)}
                onDropConversation={(id) => void move(id, ws.id)}
              />
            );
          })
        )}
        {/*
          Search-mode "no matches at all" footer. We deliberately render
          this AFTER the group map so any group with matches still
          surfaces; this row only appears when every group hid itself.
        */}
        {!empty && isFiltering && Object.values(filteredByWorkspace).every((es) => es.length === 0) && (
          <div className="px-2.5 py-3 text-row text-text-faint">No matches.</div>
        )}
      </div>
    </div>
  );
}

interface WorkspaceGroupProps {
  workspace: WorkspaceEntry;
  entries: ConversationMeta[];
  active: boolean;
  activeConversationId: string | null;
  collapsed: boolean;
  isFiltering: boolean;
  onActivate: () => void;
  onToggleCollapsed: () => void;
  onRenameWorkspace: (label: string) => void;
  onRemoveWorkspace: (id: string, opts: { deleteConversations: boolean }) => Promise<void>;
  /** Create a new chat under this workspace (activates it first if needed). */
  onNewChat: () => void;
  /** Re-stat the workspace's path after a transient mount issue. */
  onRetryReachability: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  /**
   * Conversation row dropped onto this workspace group. The handler
   * wraps `useConversationsStore.move(id, ws.id)`. The store no-ops on
   * same-workspace drops, so the drop target doesn't need to know
   * which workspace the source row currently lives under.
   */
  onDropConversation: (conversationId: string) => void;
}

function WorkspaceGroup({
  workspace,
  entries,
  active,
  activeConversationId,
  collapsed,
  isFiltering,
  onActivate,
  onToggleCollapsed,
  onRenameWorkspace,
  onRemoveWorkspace,
  onNewChat,
  onRetryReachability,
  onSelect,
  onRename,
  onRemove,
  onDropConversation
}: WorkspaceGroupProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(workspace.label);
  const inputRef = useRef<HTMLInputElement>(null);
  // Per-group fold over the chat slices. Drives `aria-busy` on the
  // group's outer container so screen readers convey "this workspace
  // has a streaming run" without any visual chrome change.
  const hasActiveRun = useWorkspaceHasActiveRun(workspace.id);

  // Two-step removal flow:
  //   step 'idle'   → no modal
  //   step 'confirm' → "Remove workspace?" prompt
  //   step 'choice' → "Delete chats too?" prompt (proceed → reparent vs delete)
  // Sequencing through local state keeps the existing `ConfirmDialog`
  // primitive in use (single yes/no modal) without introducing a new
  // tri-state dialog component.
  const [removeStep, setRemoveStep] = useState<'idle' | 'confirm' | 'choice'>('idle');
  // Reachability retry confirm dialog. Surfaced from the warning chip
  // when `workspace.unreachable === true`. Distinct from the remove
  // flow so a misclick never collapses the two destructive paths.
  const [retryDialogOpen, setRetryDialogOpen] = useState(false);
  const isUnreachable = workspace.unreachable === true;

  // Drop-target highlight. Counter-tracked rather than boolean because
  // dragenter/dragleave fires for every nested element the cursor
  // traverses (chevron button, row title, trash icon…). A single
  // boolean would flicker off-on every time the cursor crossed an
  // internal boundary; a counter only flips back to "no highlight"
  // when EVERY entered child has been left. The standard pattern for
  // robust drop targets in plain-HTML5 DnD.
  const [dragDepth, setDragDepth] = useState(0);
  const dropActive = dragDepth > 0;
  const isDragOurs = (e: React.DragEvent<HTMLElement>): boolean =>
    Array.from(e.dataTransfer.types).includes(CONV_DRAG_MIME);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  useEffect(() => {
    if (!editing) setDraft(workspace.label);
  }, [workspace.label, editing]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next.length === 0 || next === workspace.label) return;
    onRenameWorkspace(next);
  };

  // When search has hidden the body, force the group open so the user
  // can SEE the matches that justify the group's visibility.
  const effectivelyCollapsed = isFiltering ? false : collapsed;

  return (
    <div
      className={cn(
        'mt-1.5 first:mt-0 rounded-inner transition-shadow duration-150',
        // Drop highlight: a 1px accent ring on the whole group while
        // a conversation is being dragged over it. Reuses the existing
        // `ring-accent` token; no new design surface.
        dropActive && 'ring-1 ring-accent'
      )}
      aria-busy={hasActiveRun}
      onDragEnter={(e) => {
        if (!isDragOurs(e)) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!isDragOurs(e)) return;
        // `preventDefault` here is required to mark the element as a
        // valid drop target — without it, `drop` never fires.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={(e) => {
        if (!isDragOurs(e)) return;
        setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!isDragOurs(e)) return;
        e.preventDefault();
        setDragDepth(0);
        const id = e.dataTransfer.getData(CONV_DRAG_MIME);
        if (id) onDropConversation(id);
      }}
    >
      <div
        className={cn(
          'group flex w-full min-w-0 items-center gap-1.5 rounded-inner px-2 py-1 text-left',
          'transition-colors duration-150',
          active
            ? 'text-text-primary'
            : 'text-text-faint hover:bg-surface-hover hover:text-text-primary'
        )}
      >
        <button
          type="button"
          aria-label={effectivelyCollapsed ? 'Expand workspace' : 'Collapse workspace'}
          title={effectivelyCollapsed ? 'Expand' : 'Collapse'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          className={cn(
            'app-no-drag inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-inner',
            isFiltering && 'pointer-events-none opacity-40'
          )}
        >
          {effectivelyCollapsed ? (
            <ChevronRight className="h-3 w-3" strokeWidth={2.25} />
          ) : (
            <ChevronDown className="h-3 w-3" strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          onClick={onActivate}
          onDoubleClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={workspace.path}
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center">
            {isUnreachable ? (
              <FolderX className="h-3 w-3 text-warning" strokeWidth={2} />
            ) : active ? (
              <FolderOpen className="h-3 w-3" strokeWidth={2} />
            ) : (
              <Folder className="h-3 w-3" strokeWidth={2} />
            )}
          </span>
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
                } else if (e.key === 'Escape') {
                  setEditing(false);
                  setDraft(workspace.label);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 bg-transparent text-row font-medium text-text-primary outline-none focus:outline-none"
            />
          ) : (
            // Workspace labels were previously rendered with `uppercase
            // tracking-wider`, which collided visually with the
            // `WORKSPACES` eyebrow above (same casing rhythm, same
            // tracking) — both read as the same hierarchy level
            // (visible in screenshot §2 where `CODEX` and `AGENT`
            // appeared as section headings rather than entries).
            // Surface user-supplied labels in their authored case so
            // the eyebrow remains the only uppercase signal in the
            // sidebar tree.
            <span
              className="min-w-0 flex-1 truncate text-row font-medium"
              title={workspace.path}
            >
              {workspace.label}
            </span>
          )}
        </button>
        {!editing && isUnreachable && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Workspace ${workspace.label} is unreachable. Click to retry.`}
            title="Workspace folder unreachable. Click to retry."
            onClick={(e) => {
              e.stopPropagation();
              setRetryDialogOpen(true);
            }}
            className={cn(
              'app-no-drag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner',
              // Always visible (no opacity gate) so users see the
              // problem state without hovering. Hover bumps to full
              // intensity for hit-test feedback.
              'text-warning opacity-90 transition-opacity duration-150',
              'hover:opacity-100'
            )}
          >
            <AlertTriangle className="h-3 w-3" strokeWidth={2.25} />
          </button>
        )}
        {!editing && (
          <>
            <button
              type="button"
              aria-label={`New chat in ${workspace.label}`}
              title="New chat"
              onClick={(e) => {
                e.stopPropagation();
                onNewChat();
              }}
              className={cn(
                'app-no-drag inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner',
                'opacity-0 transition-opacity duration-150',
                'group-hover:opacity-60 group-focus-within:opacity-60',
                'hover:opacity-100 focus-visible:opacity-100 hover:text-text-primary'
              )}
            >
              <Plus className="h-3 w-3" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              aria-label={`Rename workspace ${workspace.label}`}
              title="Rename"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
              className={cn(
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner',
                'opacity-0 transition-opacity duration-150',
                'group-hover:opacity-60 group-focus-within:opacity-60',
                'hover:opacity-100 focus-visible:opacity-100 hover:text-text-primary'
              )}
            >
              <Pencil className="h-3 w-3" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              aria-label={`Remove workspace ${workspace.label}`}
              title="Remove"
              onClick={(e) => {
                e.stopPropagation();
                setRemoveStep('confirm');
              }}
              className={cn(
                'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner',
                'opacity-0 transition-opacity duration-150',
                'group-hover:opacity-60 group-focus-within:opacity-60',
                'hover:opacity-100 focus-visible:opacity-100 hover:text-danger'
              )}
            >
              <Trash2 className="h-3 w-3" strokeWidth={2.25} />
            </button>
          </>
        )}
      </div>
      {!effectivelyCollapsed && (
        <div className="pl-3.5 pt-0.5">
          {entries.length === 0 ? (
            // Empty workspace. Surface a real `New chat` action inline
            // instead of the silent `No chats.` line — the existing
            // `+` icon in the workspace header is hover-only, so a
            // user clicking into a fresh workspace had no visible
            // affordance to start a conversation. Suppressed in
            // search mode (where empty entries means "no matches in
            // this group" and a CTA would mislead).
            isFiltering ? null : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNewChat();
                }}
                className={cn(
                  'group/empty inline-flex w-full items-center gap-1.5 px-2.5 py-1',
                  'text-row text-text-faint transition-colors duration-150',
                  'rounded-inner hover:bg-surface-hover hover:text-text-primary'
                )}
              >
                <Plus className="h-3 w-3 shrink-0" strokeWidth={2.25} />
                <span>New chat</span>
              </button>
            )
          ) : (
            <ChatHistoryList
              entries={entries}
              activeId={activeConversationId}
              onSelect={onSelect}
              onRename={onRename}
              onRemove={onRemove}
            />
          )}
        </div>
      )}
      {/*
        Step 1 — confirm the user actually wants to remove the workspace
        from the sidebar. Made structurally distinct from the second
        step so a misclick on the trash icon never reaches the
        destructive "delete chats" path.
      */}
      <ConfirmDialog
        open={removeStep === 'confirm'}
        title="Remove workspace?"
        message={`Remove "${workspace.label}" from the sidebar? This does not touch the folder on disk.`}
        confirmLabel="Continue"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => setRemoveStep('choice')}
        onCancel={() => setRemoveStep('idle')}
      />
      {/*
        Step 2 — choose between deleting transcripts and reparenting
        them. We frame "Cancel" as the safer "Keep" path so a user
        who panics and dismisses the modal does NOT lose history. The
        confirm button is the destructive "Delete chats" branch.
      */}
      <ConfirmDialog
        open={removeStep === 'choice'}
        title="Delete chats too?"
        message={`Also delete every conversation that belongs to "${workspace.label}"? Pick "Keep" to preserve them when another workspace is available.`}
        confirmLabel="Delete chats"
        cancelLabel="Keep"
        variant="danger"
        onConfirm={() => {
          setRemoveStep('idle');
          void onRemoveWorkspace(workspace.id, { deleteConversations: true });
        }}
        onCancel={() => {
          setRemoveStep('idle');
          void onRemoveWorkspace(workspace.id, { deleteConversations: false });
        }}
      />
      {/*
        Reachability retry. Re-stats the workspace's path; on success,
        the unreachable flag clears server-side and the next list
        refresh wipes the warning chip. We don't paint a separate
        success toast — the disappearing chip is the signal.
      */}
      <ConfirmDialog
        open={retryDialogOpen}
        title="Workspace unreachable"
        message={`"${workspace.label}" couldn't be reached on this run. The folder may be on a network drive that's offline. Retry now?`}
        confirmLabel="Retry"
        cancelLabel="Close"
        onConfirm={() => {
          setRetryDialogOpen(false);
          onRetryReachability();
        }}
        onCancel={() => setRetryDialogOpen(false)}
      />
    </div>
  );
}
