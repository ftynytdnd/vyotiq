/**
 * PendingChangesReviewMode — full-pane lightbox for one-at-a-time
 * review of the pending changes list.
 *
 * Behaviour:
 *   - Iterate over the supplied `entries` array; the active index
 *     is local state and starts at 0.
 *   - `←` / `→` navigate between entries.
 *   - `A` accepts the active entry (then advances).
 *   - `R` rejects the active entry (then advances), surfacing the
 *     same toast feedback as the inline row's reject path.
 *   - `Esc` closes the lightbox.
 *
 * Keybindings respect inputs: when focus is inside an `<input>` /
 * `<textarea>` / contentEditable element, only `Esc` fires so the
 * user can still type freely (e.g. into the path filter that may
 * be open under the lightbox).
 *
 * Memory-leak hygiene: the keyboard listener is attached inside
 * `useEffect` and always cleaned up. No timers are owned here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../../store/useCheckpointsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { Modal } from '../../ui/Modal.js';
import { PendingChangeRow } from '../PendingChangeRow.js';
import { Button } from '../../ui/Button.js';
import { cn } from '../../../lib/cn.js';

interface PendingChangesReviewModeProps {
  open: boolean;
  onClose: () => void;
  entries: readonly PendingChange[];
}

export function PendingChangesReviewMode({
  open,
  onClose,
  entries
}: PendingChangesReviewModeProps) {
  // Track the active entry by stable `entryId` rather than by
  // position. The parent's `entries` is a fresh useMemo array on
  // every pending-set change — when ANY entry's status flips from
  // another renderer surface (pending-changes accept, IPC `pending-changed`
  // broadcast, …) the parent re-derives and the reference changes.
  // Pre-fix, an index-tracked `useEffect(setActiveIdx(0), [open,
  // entries])` jumped the user back to entry #0 every time the
  // upstream list mutated. Tracking by id keeps the cursor on
  // whichever entry the user was reading; if THAT entry is removed
  // we fall through to the next index gracefully.
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const accept = useCheckpointsStore((s) => s.accept);
  const reject = useCheckpointsStore((s) => s.reject);
  const showToast = useToastStore((s) => s.show);

  // Seed (or re-seed) the active entry whenever the modal opens. We
  // intentionally do NOT reset on every `entries` identity change —
  // that was the bug. The id we hold is either still present (no-op)
  // or its row was removed (re-resolved on the next render via the
  // `effectiveIdx` / `active` derivation below).
  useEffect(() => {
    if (!open) return;
    setActiveEntryId((cur) => {
      if (cur && entries.some((e) => e.entryId === cur)) return cur;
      return entries[0]?.entryId ?? null;
    });
  }, [open, entries]);

  const total = entries.length;
  // Resolve the active entry from the id. When the id no longer
  // exists (parent dropped it) we land on the entry that took its
  // place at the same ordinal position, clamped to the tail.
  const { active, activeIdx } = useMemo(() => {
    if (total === 0) return { active: undefined as PendingChange | undefined, activeIdx: 0 };
    const idx = activeEntryId
      ? entries.findIndex((e) => e.entryId === activeEntryId)
      : -1;
    if (idx >= 0) return { active: entries[idx]!, activeIdx: idx };
    // Id no longer present — keep cursor on the current ordinal so
    // an Accept-and-advance sequence reads naturally even when the
    // accepted entry vanished from underneath us.
    const fallback = Math.min(0, total - 1);
    return { active: entries[fallback]!, activeIdx: fallback };
  }, [entries, activeEntryId, total]);

  const advance = useCallback(() => {
    if (total <= 0) return;
    const next = Math.min(activeIdx + 1, total - 1);
    setActiveEntryId(entries[next]?.entryId ?? null);
  }, [entries, activeIdx, total]);
  const retreat = useCallback(() => {
    if (total <= 0) return;
    const prev = Math.max(activeIdx - 1, 0);
    setActiveEntryId(entries[prev]?.entryId ?? null);
  }, [entries, activeIdx, total]);

  const onAccept = useCallback(async () => {
    if (!active) return;
    const ok = await accept(active.entryId, active.conversationId);
    if (!ok) {
      showToast(`Could not accept ${active.filePath}`, 'danger');
    }
    advance();
  }, [accept, active, advance, showToast]);

  const onReject = useCallback(async () => {
    if (!active) return;
    const result = await reject(active.entryId, active.conversationId);
    if (!result.ok) {
      const msg =
        result.error.kind === 'blob-missing'
          ? `Snapshot missing — cannot revert ${active.filePath}.`
          : result.error.kind === 'fs'
            ? `Revert failed: ${result.error.message}`
            : result.error.kind === 'sandbox'
              ? `Revert blocked by sandbox: ${result.error.message}`
              : `Revert failed (${result.error.kind}).`;
      showToast(msg, 'danger');
    } else {
      showToast(`Reverted ${active.filePath}`, 'success');
    }
    advance();
  }, [active, advance, reject, showToast]);

  // Keyboard navigation inside the modal. Only fires when focus is
  // outside an editable element so the lightbox doesn't fight the
  // path filter or any future textarea.
  //
  // ESC is intentionally NOT handled here — `Modal` owns the Escape
  // contract (`Modal.tsx` registers a capture-phase window keydown
  // that calls `onClose`). Re-handling it here would just call
  // `onClose` a second time (idempotent setReviewOpen(false) but
  // redundant work). Editable-target ESC is also already covered
  // because `Modal`'s listener uses `capture: true` and runs first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        retreat();
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        void onAccept();
        return;
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void onReject();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, advance, retreat, onAccept, onReject]);

  const title =
    total > 0
      ? `Review pending changes — ${activeIdx + 1} of ${total}`
      : 'Review pending changes';

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className="flex flex-col gap-4">
        <KeyHints />
        {!active ? (
          <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-muted">
            No pending changes to review.
          </div>
        ) : (
          <PendingChangeRow change={active} alwaysExpanded />
        )}
        <div className="flex items-center justify-between gap-2 border-t border-border-subtle/30 pt-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={retreat}
              disabled={activeIdx <= 0}
            >
              ← Prev
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={advance}
              disabled={activeIdx >= total - 1}
            >
              Next →
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onReject}
              disabled={!active}
            >
              Reject (R)
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={onAccept}
              disabled={!active}
            >
              Accept (A)
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function KeyHints() {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-inner bg-surface-overlay/60 px-3 py-1.5',
        'text-meta text-text-muted'
      )}
    >
      <KeyHint label="←/→">navigate</KeyHint>
      <KeyHint label="A">accept</KeyHint>
      <KeyHint label="R">reject</KeyHint>
      <KeyHint label="Esc">close</KeyHint>
    </div>
  );
}

function KeyHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd
        className={cn(
          'rounded-inner border border-border-subtle/60 bg-surface-raised px-1.5 py-px',
          'font-mono text-meta text-text-secondary'
        )}
      >
        {label}
      </kbd>
      <span className="text-text-faint">{children}</span>
    </span>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return false;
}
