/**
 * Conversation history list. Each row is a strict visual clone of
 * `SidebarNav`'s `NavItem` (the `Workspace: …` button) so the Chats
 * section reads as a continuation of the same sidebar rhythm:
 *
 *   - Same dimensions: `gap-2.5 rounded-md px-2.5 py-1.5 text-row`.
 *   - Same color states: inactive `text-text-muted`; hover/active
 *     `bg-surface-hover text-text-primary`.
 *   - Same icon size (`h-3.5 w-3.5`) and stroke (`2`) — no tint, the
 *     icon inherits from the row's text color.
 *
 * Chat-specific behavior layered on top:
 *   - Click: select (load transcript).
 *   - Double-click title: rename inline.
 *   - Trash icon (fades in on hover, hidden otherwise): delete.
 *   - Drag: each row is `draggable`; dragging carries the
 *     conversation id through the custom MIME type
 *     `CONV_DRAG_MIME` and the drop target (`WorkspaceGroup`) calls
 *     `useConversationsStore.move(id, ws.id)` on drop. Same-workspace
 *     drops are a no-op server-side. The sidebar's drag affordance is
 *     intentionally subtle (slight opacity dip on the source row) so
 *     it stays out of the way until the user is mid-drag.
 */

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Trash2 } from 'lucide-react';
import type { ConversationMeta } from '@shared/types/chat.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { cn } from '../../lib/cn.js';
import { useConversationProcessing } from '../../hooks/chat/index.js';
import { useSidebarRowFocus } from '../../hooks/sidebar/index.js';
import { RunningTitle, RunStopButton } from './runIndicators/index.js';

/**
 * MIME type carried by a sidebar drag operation. Custom string keeps us
 * out of the way of any platform-native drag (file drops, text drags
 * from external apps) — only OUR drops trigger the workspace-group
 * highlight + move handler. Must stay lowercase per the WHATWG
 * DataTransfer spec.
 */
export const CONV_DRAG_MIME = 'application/x-vyotiq-conv-id';

interface ChatHistoryListProps {
  entries: ConversationMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
}

export function ChatHistoryList({
  entries,
  activeId,
  onSelect,
  onRename,
  onRemove
}: ChatHistoryListProps) {
  // Empty state is owned upstream by `ChatsSection` (`No chats` /
  // `No matches.`) so this list only renders when there is at least one
  // entry. Keeping the empty branch here would duplicate copy and create
  // two divergent paths to maintain.
  return (
    <div className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <Row
          key={entry.id}
          entry={entry}
          active={entry.id === activeId}
          onSelect={() => onSelect(entry.id)}
          onRename={(t) => onRename(entry.id, t)}
          onRemove={() => onRemove(entry.id)}
        />
      ))}
    </div>
  );
}

interface RowProps {
  entry: ConversationMeta;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}

function Row({ entry, active, onSelect, onRename, onRemove }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Local "I am being dragged" flag so the source row can dim itself
  // for cursor feedback. Cleared on dragend regardless of drop outcome
  // so an aborted drag (Esc, drop outside any target) doesn't leave
  // the row stuck at reduced opacity.
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Subscribed via the same hook RunningTitle uses; cheap because the
  // shallow comparator only re-renders on this slice's transitions.
  // Drives the per-row Stop ↔ Trash swap below.
  const { isProcessing, runId } = useConversationProcessing(entry.id);
  // Register this row's outer element under its conversation id so the
  // composer's `RunningElsewhereHint` can scroll directly to it via
  // `focusRow(id)`.
  const registerRowRef = useSidebarRowFocus(entry.id);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Sync draft when the meta updates externally (auto-titling, etc.).
  useEffect(() => {
    if (!editing) setDraft(entry.title);
  }, [entry.title, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next.length === 0 || next === entry.title) return;
    onRename(next);
  };

  return (
    <div
      ref={registerRowRef}
      // Drag bookkeeping. `editing` suppresses the drag origin so a
      // mousedown inside the rename input (which auto-selects on
      // mount) doesn't accidentally start a drag — `draggable={false}`
      // during edit mode is the cleanest fix.
      draggable={!editing}
      onDragStart={(e) => {
        if (editing) return;
        // Custom MIME (id payload) + a plaintext fallback so external
        // drop targets (e.g. a paste into a text field) get something
        // human-readable. The custom MIME is the one the WorkspaceGroup
        // drop target inspects via `dataTransfer.types`; without it, a
        // generic external drag could trigger our group highlight.
        e.dataTransfer.setData(CONV_DRAG_MIME, entry.id);
        e.dataTransfer.setData('text/plain', entry.title);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      data-conv-id={entry.id}
      className={cn(
        'app-no-drag group flex w-full min-w-0 items-center gap-2.5 rounded-inner px-2.5 py-1.5 text-left text-row',
        'transition-colors duration-150',
        active
          ? 'bg-surface-hover text-text-primary'
          : 'text-text-muted hover:bg-surface-hover hover:text-text-primary',
        // Subtle source-row dim while dragging — purely a feedback
        // affordance. The drop target's ring is the dominant signal.
        dragging && 'opacity-50'
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => setEditing(true)}
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <MessageSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        </span>
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
              } else if (e.key === 'Escape') {
                setEditing(false);
                setDraft(entry.title);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'min-w-0 flex-1 bg-transparent text-row text-text-primary',
              'outline-none focus:outline-none'
            )}
          />
        ) : (
          // RunningTitle subscribes to its own slice and toggles
          // `vyotiq-shimmer-text` while the run is in flight — idle
          // rows render byte-identically to the previous <span>.
          <RunningTitle id={entry.id} title={entry.title} />
        )}
      </button>
      {!editing &&
        (isProcessing && runId ? (
          // Per-row Stop affordance: aborts THIS conversation's run
          // without switching to it. The slice flips back to idle on
          // the terminal `done` / `error` event, restoring the trash
          // button automatically.
          <RunStopButton runId={runId} conversationTitle={entry.title} />
        ) : (
          <button
            type="button"
            aria-label={`Delete conversation ${entry.title}`}
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteOpen(true);
            }}
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-inner',
              // Visible on hover, on keyboard focus, and when any
              // descendant of the row has focus — so tabbing into the
              // row surfaces the action without forcing the user to
              // hover. Visual treatment for mouse users is unchanged.
              'opacity-0 transition-opacity duration-150',
              'group-hover:opacity-60 group-focus-within:opacity-60',
              'hover:opacity-100 focus-visible:opacity-100 hover:text-danger'
            )}
          >
            <Trash2 className="h-3 w-3" strokeWidth={2.25} />
          </button>
        ))}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete conversation?"
        message={`Delete "${entry.title}"? This removes the saved transcript.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          setDeleteOpen(false);
          onRemove();
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
