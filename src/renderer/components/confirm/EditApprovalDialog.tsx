/**
 * EditApprovalDialog — full-diff preview for `strictApprovals` mode.
 *
 * Mounted by `ConfirmHost` when a `tools:request-confirm` payload
 * carries an `edit-approval` envelope. Renders inside a
 * {@link ComposerDialog} above the chat composer (the legacy bottom
 * sheet has been removed) with three distinct surfaces:
 *
 *   - **Compact preview (default)** — header row (verb badge + path
 *     + diff stats) and the FIRST 3 lines of the diff. The user can
 *     "Show full diff" to expand to the scrolling full diff.
 *   - **Sticky footer** — Deny / Accept all remaining / Accept always
 *     visible regardless of scroll/expand state.
 *   - **Queue indicators** — when more than one approval is pending,
 *     a stepper badge ("Approval N of M") sits in the header and a
 *     one-line "Next up" footer strip previews the next file.
 *
 * Three reply paths (unchanged from the prior implementation):
 *   - Deny → `respondConfirm(id, false)`
 *   - Accept → `respondConfirm(id, { approved: true })`
 *   - Accept all remaining → `respondConfirm(id, { approved: true,
 *     acceptAllRemaining: true })`
 */

import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FilePlus,
  PencilLine,
  Trash2
} from 'lucide-react';
import type {
  ConfirmRequest,
  EditApprovalPayload
} from '@shared/types/ipc.js';
import { Button } from '../ui/Button.js';
import { ComposerDialog } from '../ui/ComposerDialog.js';
import { ComposerDialogPortal } from '../ui/ComposerDialogAnchor.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { UnifiedDiffPanel } from '../diff/UnifiedDiffPanel.js';
import { chromeStatusPillClassName } from '../ui/SurfaceShell.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../lib/shellIcons.js';
import { timelineRowHeaderClassName } from '../timeline/shared/rowStyles.js';

interface EditApprovalDialogProps {
  open: boolean;
  payload: EditApprovalPayload;
  /** 1-based index within the edit-approval queue. */
  queuePosition: number;
  /** Total edit approvals waiting (including this one). */
  queueTotal: number;
  /** Items still behind this one in the edit queue. */
  queuedBehind: number;
  /** Screen-reader queue announcement. */
  queueAnnouncement?: string;
  /** Optional preview of the next item in the queue (footer strip). */
  nextInQueue?: ConfirmRequest | null;
  onApprove: () => void;
  onApproveAll: () => void;
  onDeny: () => void;
}

const COMPACT_DIFF_LINES = 3;

export function EditApprovalDialog({
  open,
  payload,
  queuePosition,
  queueTotal,
  queuedBehind,
  queueAnnouncement,
  nextInQueue,
  onApprove,
  onApproveAll,
  onDeny
}: EditApprovalDialogProps) {
  const { operation, filePath, preBody, postBody, additions, deletions } = payload;
  const Icon = operation === 'create' ? FilePlus : operation === 'delete' ? Trash2 : PencilLine;
  const verbLabel =
    operation === 'create' ? 'CREATE' : operation === 'delete' ? 'DELETE' : 'MODIFY';
  const verbTone =
    operation === 'delete'
      ? 'danger'
      : operation === 'create'
        ? 'success'
        : 'neutral';

  const [showFull, setShowFull] = useState(false);
  // Reset to compact every time the active payload changes (queue
  // advances). Tracking by file path + operation is good enough — two
  // back-to-back approvals against the same target are rare and a
  // residual "expanded" state is harmless.
  const payloadKey = `${operation}:${filePath}`;
  const lastKeyRef = useRef(payloadKey);
  if (lastKeyRef.current !== payloadKey) {
    lastKeyRef.current = payloadKey;
    if (showFull) setShowFull(false);
  }

  const acceptRef = useRef<HTMLButtonElement>(null);

  const queueBadge =
    queueTotal > 1 ? (
      <span
        className={chromeStatusPillClassName(
          'neutral',
          'shrink-0 font-medium tracking-wide'
        )}
      >
        Approval {queuePosition} of {queueTotal}
      </span>
    ) : null;

  const compactPreview = useMemo(
    () => buildCompactPreview(operation, preBody, postBody, COMPACT_DIFF_LINES),
    [operation, preBody, postBody]
  );

  const nextLabel = useMemo(() => describeNext(nextInQueue ?? null), [nextInQueue]);

  if (!open) return null;

  return (
    <ComposerDialogPortal>
      <ComposerDialog
        open
        onClose={onDeny}
        title="Approve edit"
        size={showFull ? 'expanded' : 'compact'}
        onEscapeFromExpanded={() => setShowFull(false)}
        badge={queueBadge}
        {...(queueAnnouncement ? { queueAnnouncement } : {})}
        enterPrimaryRef={acceptRef}
      >
        <div className="flex flex-col gap-3">
          <div className={timelineRowHeaderClassName}>
            <span
              className={chromeStatusPillClassName(
                verbTone,
                'shrink-0 font-mono uppercase tracking-wider'
              )}
            >
              {verbLabel}
            </span>
            <Icon
              className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint')}
              strokeWidth={SHELL_ACTION_ICON_STROKE}
            />
            <div
              className="min-w-0 flex-1 truncate font-mono text-row text-text-primary"
              title={filePath}
            >
              {filePath}
            </div>
            <DiffStatsBadge additions={additions} deletions={deletions} className="shrink-0" />
          </div>

          {showFull ? (
            <UnifiedDiffPanel
              kind={operation}
              {...(typeof preBody === 'string' ? { preBody } : {})}
              {...(typeof postBody === 'string' ? { postBody } : {})}
              variant="authoritative"
            />
          ) : (
            <CompactDiffPreview
              preview={compactPreview}
              onExpand={() => setShowFull(true)}
            />
          )}

          {showFull && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowFull(false)}
              className="self-start"
            >
              <ChevronUp
                className={SHELL_ROW_ICON_CLASS}
                strokeWidth={SHELL_ACTION_ICON_STROKE}
              />
              Hide full diff
            </Button>
          )}

          <ShellCaption>
            {operation === 'delete'
              ? 'A snapshot is saved so you can still revert this after approving.'
              : 'A snapshot is saved on every approved edit — revert any time from the Checkpoints view.'}
          </ShellCaption>
        </div>

        <div className="vx-composer-dialog-sticky-footer mt-3 flex flex-col gap-2 border-t border-border-subtle/20 pt-3">
          {nextLabel && queueTotal > 1 && (
            <div className="vx-caption truncate text-text-faint" title={nextLabel}>
              Next: {nextLabel}{' '}
              {queuedBehind > 1 && (
                <span className="text-text-faint">(+{queuedBehind - 1} after this)</span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onDeny}>
              Deny
            </Button>
            <Button size="sm" variant="secondary" onClick={onApproveAll}>
              Accept all remaining
            </Button>
            <Button ref={acceptRef} size="sm" variant="primary" onClick={onApprove}>
              Accept
            </Button>
          </div>
        </div>
      </ComposerDialog>
    </ComposerDialogPortal>
  );
}

/* ------------------------------------------------------------------ */
/*                       Compact diff preview                          */
/* ------------------------------------------------------------------ */

interface CompactPreviewLine {
  prefix: '+' | '-' | ' ';
  text: string;
}

interface CompactPreviewResult {
  lines: CompactPreviewLine[];
  truncatedLines: number;
}

function buildCompactPreview(
  operation: 'create' | 'delete' | 'modify',
  preBody: string | undefined,
  postBody: string | undefined,
  limit: number
): CompactPreviewResult {
  if (operation === 'create') {
    const all = (postBody ?? '').split(/\r?\n/);
    const lines = all
      .slice(0, limit)
      .map((text) => ({ prefix: '+' as const, text }));
    return { lines, truncatedLines: Math.max(0, all.length - lines.length) };
  }
  if (operation === 'delete') {
    const all = (preBody ?? '').split(/\r?\n/);
    const lines = all
      .slice(0, limit)
      .map((text) => ({ prefix: '-' as const, text }));
    return { lines, truncatedLines: Math.max(0, all.length - lines.length) };
  }
  // Modify — shallow line-by-line diff focusing on the first changed
  // lines. We don't try to be a full diff algorithm (UnifiedDiffPanel
  // owns that). The preview just shows first divergence so the user
  // gets a sense of the change before expanding.
  const pre = (preBody ?? '').split(/\r?\n/);
  const post = (postBody ?? '').split(/\r?\n/);
  const lines: CompactPreviewLine[] = [];
  let i = 0;
  let j = 0;
  let totalChanges = 0;
  while (i < pre.length || j < post.length) {
    const a = pre[i];
    const b = post[j];
    if (a === b) {
      i += 1;
      j += 1;
      continue;
    }
    if (a !== undefined) {
      if (lines.length < limit) lines.push({ prefix: '-', text: a });
      totalChanges += 1;
      i += 1;
    }
    if (b !== undefined) {
      if (lines.length < limit) lines.push({ prefix: '+', text: b });
      totalChanges += 1;
      j += 1;
    }
    if (lines.length >= limit && (i < pre.length || j < post.length)) {
      // Walk the rest only to count remaining changes for the
      // "+ N more" hint.
      while (i < pre.length || j < post.length) {
        if (pre[i] !== post[j]) totalChanges += 1;
        if (pre[i] !== undefined) i += 1;
        if (post[j] !== undefined) j += 1;
      }
      break;
    }
  }
  return { lines, truncatedLines: Math.max(0, totalChanges - lines.length) };
}

function CompactDiffPreview({
  preview,
  onExpand
}: {
  preview: CompactPreviewResult;
  onExpand: () => void;
}) {
  return (
    <div className="vx-edit-compact-diff flex flex-col gap-2 rounded-[var(--radius-inner)] border border-border-subtle/30 bg-surface-sunken/40 p-2 font-mono text-meta">
      {preview.lines.length === 0 ? (
        <div className="vx-caption italic">No textual change preview available.</div>
      ) : (
        <div className="flex flex-col">
          {preview.lines.map((line, idx) => (
            <span
              key={idx}
              className={cn(
                'whitespace-pre-wrap leading-snug',
                line.prefix === '+' && 'text-success',
                line.prefix === '-' && 'text-danger',
                line.prefix === ' ' && 'text-text-faint'
              )}
            >
              {line.prefix} {line.text}
            </span>
          ))}
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={onExpand} className="self-start">
        <ChevronDown
          className={SHELL_ROW_ICON_CLASS}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
        Show full diff
        {preview.truncatedLines > 0 && (
          <span className="text-text-faint"> (+{preview.truncatedLines} more)</span>
        )}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*                   Queue "next up" preview helper                    */
/* ------------------------------------------------------------------ */

function describeNext(next: ConfirmRequest | null): string | null {
  if (!next) return null;
  if (next.payload?.kind === 'edit-approval') {
    const op = next.payload.operation;
    const verb = op === 'create' ? 'create' : op === 'delete' ? 'delete' : 'edit';
    return `${verb} ${next.payload.filePath}`;
  }
  // Plain-text confirm — fall back to the message (truncated by CSS).
  return next.message || 'pending confirmation';
}
