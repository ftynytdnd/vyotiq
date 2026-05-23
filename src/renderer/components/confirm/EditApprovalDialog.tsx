/**
 * EditApprovalDialog — full-diff preview for `strictApprovals` mode.
 *
 * Mounted by `ConfirmHost` when a `tools:request-confirm` payload
 * carries an `edit-approval` envelope. Shows the file path, the kind
 * of mutation (CREATE / MODIFY / DELETE), the diff stats, and the
 * full unified diff (modify) or full body preview (create / delete).
 *
 * Three reply paths:
 *   - Deny → `respondConfirm(id, false)` (returns to the tool as
 *     `permission denied`).
 *   - Accept → `respondConfirm(id, { approved: true })` (this edit
 *     applies; further edits in the same run prompt again).
 *   - Accept all remaining in this run →
 *     `respondConfirm(id, { approved: true, acceptAllRemaining: true })`
 *     (latches the orchestrator's per-run flag so subsequent edits
 *     skip the prompt).
 *
 * Styling stays inside the existing stealth-dark token set — no
 * card chrome, no emojis. Reuses `EditDiffView` for modify AND
 * create (via `synthesizeCreateHunks`) so all three create
 * surfaces — timeline `EditInvocation` settled-create, pending-
 * changes panel, approval dialog — render the new file body as
 * an all-`+` hunk identically. `CodeBlock tone="danger"` is
 * still used for the delete preview to mirror
 * `PendingChangeDiff`'s delete branch.
 */

import { useMemo } from 'react';
import { FilePlus, PencilLine, Trash2 } from 'lucide-react';
import type { EditApprovalPayload } from '@shared/types/ipc.js';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { EditDiffView } from '../timeline/tools/edit/EditDiffView.js';
import { CodeBlock } from '../timeline/tools/shared/CodeBlock.js';
import { synthesizeCreateHunks } from '../timeline/tools/edit/synthesizeDiffPreview.js';
import { computeDiffHunksClient } from '../checkpoints/diffClient.js';
import { cn } from '../../lib/cn.js';
import { timelineRowHeaderClassName } from '../timeline/shared/rowStyles.js';

interface EditApprovalDialogProps {
  open: boolean;
  payload: EditApprovalPayload;
  /** Queue depth pill ("N queued behind") shown in the header. */
  queuedBehind: number;
  onApprove: () => void;
  onApproveAll: () => void;
  onDeny: () => void;
}

export function EditApprovalDialog({
  open,
  payload,
  queuedBehind,
  onApprove,
  onApproveAll,
  onDeny
}: EditApprovalDialogProps) {
  const { operation, filePath, preBody, postBody, hunks, additions, deletions } = payload;
  const Icon = operation === 'create' ? FilePlus : operation === 'delete' ? Trash2 : PencilLine;
  const verbLabel =
    operation === 'create' ? 'CREATE' : operation === 'delete' ? 'DELETE' : 'MODIFY';
  const verbToneClass =
    operation === 'delete'
      ? 'bg-danger-soft text-danger'
      : operation === 'create'
        ? 'bg-success-soft text-success'
        : 'bg-surface-overlay text-text-muted';

  const title =
    queuedBehind > 0 ? `Approve edit (+${queuedBehind} queued)` : 'Approve edit';

  // Compute hunks lazily for modify if main didn't precompute (cheap
  // fall-back — main always provides them for `edit`, but bash
  // recovery might not in the future). Memoised on the body pair so
  // a parent re-render mid-dialog (queue-depth pill flipping, etc.)
  // doesn't re-run the O(n·m) LCS walk. Review finding M9.
  const modifyHunks = useMemo(() => {
    if (operation !== 'modify') return null;
    if (hunks && hunks.length > 0) return hunks;
    if (typeof preBody === 'string' && typeof postBody === 'string') {
      return computeDiffHunksClient(preBody, postBody);
    }
    return null;
  }, [operation, hunks, preBody, postBody]);

  return (
    <Modal open={open} onClose={onDeny} title={title} size="lg">
      <div className="flex flex-col gap-3">
        {/* Header row: kind badge + path + diff stats */}
        <div className={timelineRowHeaderClassName}>
          <span
            className={cn(
              'shrink-0 rounded-inner px-1.5 py-0.5 font-mono text-meta uppercase tracking-wider',
              verbToneClass
            )}
          >
            {verbLabel}
          </span>
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2} />
          <div
            className="min-w-0 flex-1 truncate font-mono text-row text-text-primary"
            title={filePath}
          >
            {filePath}
          </div>
          <DiffStatsBadge additions={additions} deletions={deletions} className="shrink-0" />
        </div>

        {/* Diff / body preview */}
        <div className="flex flex-col gap-2">
          {operation === 'modify' && modifyHunks && modifyHunks.length > 0 && (
            <EditDiffView hunks={modifyHunks} variant="authoritative" />
          )}
          {operation === 'modify' && (!modifyHunks || modifyHunks.length === 0) && (
            <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-muted">
              No textual changes.
            </div>
          )}
          {operation === 'create' && (
            // Render the new file body as an all-`+` hunk via the
            // shared `EditDiffView` so the approval dialog matches
            // the timeline `EditInvocation` settled-create branch
            // and `PendingChangeDiff`'s create branch byte-for-byte.
            // Empty-body create still produces one empty `+` line —
            // same behaviour as the other two surfaces.
            <EditDiffView
              key="approval-create"
              hunks={synthesizeCreateHunks(postBody ?? '')}
              variant="authoritative"
            />
          )}
          {operation === 'delete' && (
            <CodeBlock body={preBody ?? ''} tone="danger" />
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-meta text-text-faint">
            {operation === 'delete'
              ? 'A snapshot is saved so you can still revert this after approving.'
              : 'A snapshot is saved on every approved edit — revert any time from the Checkpoints view.'}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="ghost" onClick={onDeny}>
              Deny
            </Button>
            <Button size="sm" variant="secondary" onClick={onApproveAll}>
              Accept all remaining
            </Button>
            <Button size="sm" variant="primary" onClick={onApprove} autoFocus>
              Accept
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
