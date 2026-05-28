/**
 * Embeddable pending-changes review body (file nav, diff, PR metadata).
 * Used by the SecondaryZone review drawer and optionally the modal shell.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { PendingChangeFileGroup } from './PendingChangeFileGroup.js';
import { Button } from '../../ui/Button.js';
import { chromeInsetNoteClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { fileGroupKey, groupByFilePath } from './groupPendingByPath.js';
import {
  usePendingChangeActions,
  usePendingChangeBulkActions
} from '../shared/usePendingChangeActions.js';
import { pendingPanelShellClassName } from './pendingPanelStyles.js';
import { ReviewSessionPanel } from '../review/ReviewSessionPanel.js';
import { useCheckpointsStore } from '../../../store/useCheckpointsStore.js';

/** Tall diff for review surface (~70vh). */
const REVIEW_DIFF_MAX_HEIGHT = 'max-h-[min(70vh,42rem)]';

function ReviewRowFrame({ children }: { virtualise: boolean; children: ReactNode }) {
  return <>{children}</>;
}

export interface PendingChangesReviewBodyProps {
  entries: readonly PendingChange[];
  /** When set, selects this file on mount / when entries change. */
  initialFilePath?: string | null;
  /** Called after the user reviews the last file (optional). */
  onFinished?: () => void;
}

export function PendingChangesReviewBody({
  entries,
  initialFilePath = null,
  onFinished
}: PendingChangesReviewBodyProps) {
  const fileGroups = useMemo(() => groupByFilePath(entries), [entries]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [commentLine, setCommentLine] = useState<number | null>(null);

  useEffect(() => {
    if (fileGroups.length === 0) {
      onFinished?.();
      return;
    }
    setActiveFilePath((cur) => {
      if (initialFilePath) {
        const hit = fileGroups.find((g) => g.filePath === initialFilePath);
        if (hit) return fileGroupKey(hit.workspaceId, hit.filePath);
      }
      if (cur && fileGroups.some((g) => fileGroupKey(g.workspaceId, g.filePath) === cur)) {
        return cur;
      }
      const first = fileGroups[0];
      return first ? fileGroupKey(first.workspaceId, first.filePath) : null;
    });
  }, [fileGroups, initialFilePath, onFinished]);

  useEffect(() => {
    setCommentLine(null);
  }, [activeFilePath]);

  const conversationId = entries[0]?.conversationId ?? '';
  const runId = entries[0]?.runId;

  const total = fileGroups.length;
  const { activeGroup, activeIdx } = useMemo(() => {
    if (total === 0) {
      return { activeGroup: undefined as (typeof fileGroups)[number] | undefined, activeIdx: 0 };
    }
    const idx = activeFilePath
      ? fileGroups.findIndex(
          (g) => fileGroupKey(g.workspaceId, g.filePath) === activeFilePath
        )
      : -1;
    if (idx >= 0) return { activeGroup: fileGroups[idx]!, activeIdx: idx };
    return { activeGroup: fileGroups[0]!, activeIdx: 0 };
  }, [activeFilePath, fileGroups, total]);

  const advance = useCallback(() => {
    if (total <= 0) return;
    if (activeIdx >= total - 1) {
      onFinished?.();
      return;
    }
    const next = activeIdx + 1;
    const nextGroup = fileGroups[next];
    setActiveFilePath(
      nextGroup ? fileGroupKey(nextGroup.workspaceId, nextGroup.filePath) : null
    );
  }, [activeIdx, fileGroups, onFinished, total]);

  const retreat = useCallback(() => {
    if (total <= 0) return;
    const prev = Math.max(activeIdx - 1, 0);
    const prevGroup = fileGroups[prev];
    setActiveFilePath(
      prevGroup ? fileGroupKey(prevGroup.workspaceId, prevGroup.filePath) : null
    );
  }, [activeIdx, fileGroups, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        retreat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, retreat]);

  if (fileGroups.length === 0) {
    return (
      <div className={cn(chromeInsetNoteClassName, 'text-text-muted')}>
        No pending changes to review.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <KeyHints />
      <p className="text-meta text-text-muted">
        File {activeIdx + 1} of {total}
      </p>
      {activeGroup && (
        <div className={cn(pendingPanelShellClassName(false), 'overflow-hidden')}>
          <PendingChangeFileGroup
            entries={activeGroup.entries}
            virtualise={false}
            RowFrame={ReviewRowFrame}
            reviewMode
            diffMaxHeightClass={REVIEW_DIFF_MAX_HEIGHT}
            linePick={{
              highlightLine: commentLine,
              onPick: setCommentLine
            }}
          />
        </div>
      )}
      {activeGroup && conversationId && (
        <ReviewSessionPanel
          workspaceId={activeGroup.workspaceId}
          conversationId={conversationId}
          filePath={activeGroup.filePath}
          commentLine={commentLine}
          onCommentLineChange={setCommentLine}
          {...(runId ? { runId } : {})}
        />
      )}
      {activeGroup && <ReviewFileActions group={activeGroup} onAdvance={advance} />}
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle/30 pt-3">
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={retreat} disabled={activeIdx <= 0}>
            ← Prev
          </Button>
          <Button size="sm" variant="ghost" onClick={advance} disabled={activeIdx >= total - 1}>
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewFileActions({
  group,
  onAdvance
}: {
  group: { workspaceId: string; filePath: string; entries: readonly PendingChange[] };
  onAdvance: () => void;
}) {
  if (group.entries.length > 1) {
    return <BulkReviewFileActions entries={group.entries} onAdvance={onAdvance} />;
  }
  return <SingleReviewFileActions change={group.entries[0]!} onAdvance={onAdvance} />;
}

function SingleReviewFileActions({
  change,
  onAdvance
}: {
  change: PendingChange;
  onAdvance: () => void;
}) {
  const { onReject } = usePendingChangeActions(change);
  const accept = useCheckpointsStore((s) => s.accept);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        void accept(change.entryId, change.conversationId).then((ok) => {
          if (ok) onAdvance();
        });
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void onReject().then(onAdvance);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accept, change.conversationId, change.entryId, onAdvance, onReject]);

  return (
    <div className="flex justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void onReject().then(onAdvance);
        }}
      >
        Reject (R)
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          void accept(change.entryId, change.conversationId).then((ok) => {
            if (ok) onAdvance();
          });
        }}
      >
        Accept (A)
      </Button>
    </div>
  );
}

function BulkReviewFileActions({
  entries,
  onAdvance
}: {
  entries: readonly PendingChange[];
  onAdvance: () => void;
}) {
  const { onAcceptAll, onRejectAll } = usePendingChangeBulkActions(entries);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        void onAcceptAll().then(onAdvance);
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void onRejectAll().then(onAdvance);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAcceptAll, onAdvance, onRejectAll]);

  return (
    <div className="flex justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void onRejectAll().then(onAdvance);
        }}
      >
        Reject file (R)
      </Button>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          void onAcceptAll().then(onAdvance);
        }}
      >
        Accept file (A)
      </Button>
    </div>
  );
}

function KeyHints() {
  return (
    <div
      className={cn(
        chromeInsetNoteClassName,
        'flex flex-wrap items-center gap-2 py-1.5 text-meta text-text-muted'
      )}
    >
      <KeyHint label="←/→">files</KeyHint>
      <KeyHint label="A">accept file</KeyHint>
      <KeyHint label="R">reject file</KeyHint>
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
