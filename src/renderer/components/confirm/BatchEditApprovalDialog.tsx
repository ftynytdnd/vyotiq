/**
 * Batch summary for large edit-approval queues. Shown when the
 * ConfirmHost pending edit-approvals exceed the batch threshold so the
 * user can Deny all / Approve all / fall back to per-file review.
 */

import { useMemo, useRef, useState } from 'react';
import type { ConfirmRequest, EditApprovalPayload } from '@shared/types/ipc.js';
import { Button } from '../ui/Button.js';
import { ComposerDialog } from '../ui/ComposerDialog.js';
import { ComposerDialogPortal } from '../ui/ComposerDialogAnchor.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';

export const EDIT_APPROVAL_BATCH_THRESHOLD = 5;

export interface BatchEditApprovalDialogProps {
  pending: ConfirmRequest[];
  onDenyAll: () => void;
  onApproveAll: () => void;
  onReviewOneByOne: () => void;
}

function isEditApproval(req: ConfirmRequest): req is ConfirmRequest & { payload: EditApprovalPayload } {
  return req.payload?.kind === 'edit-approval';
}

export function BatchEditApprovalDialog({
  pending,
  onDenyAll,
  onApproveAll,
  onReviewOneByOne
}: BatchEditApprovalDialogProps) {
  const [expanded, setExpanded] = useState(false);
  const approveAllRef = useRef<HTMLButtonElement>(null);

  const editItems = useMemo(() => pending.filter(isEditApproval), [pending]);

  const { fileCount, editCount, filePaths } = useMemo(() => {
    const paths = new Set<string>();
    for (const item of editItems) {
      paths.add(item.payload.filePath);
    }
    return {
      editCount: editItems.length,
      fileCount: paths.size,
      filePaths: [...paths].sort()
    };
  }, [editItems]);

  const summary =
    editCount === 1
      ? `Approve 1 edit to ${filePaths[0] ?? 'one file'}?`
      : `Approve ${editCount} edits across ${fileCount} file${fileCount === 1 ? '' : 's'}?`;

  return (
    <ComposerDialogPortal>
      <ComposerDialog
        open
        onClose={onDenyAll}
        title="Batch edit approval"
        size="compact"
        enterPrimaryRef={approveAllRef}
        badge={
          <span className="text-meta font-medium text-text-faint">
            {editCount} queued
          </span>
        }
        queueAnnouncement={`${editCount} edit approvals queued`}
      >
        <div className="flex flex-col gap-3">
          <ShellCaption className="text-body leading-relaxed text-text-secondary">
            {summary} You chose to read every diff — use Review one by one to inspect each
            change, or approve the whole batch below.
          </ShellCaption>

          <button
            type="button"
            className="vx-btn-text self-start text-row text-text-faint hover:text-text-secondary"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide file list' : `Show ${fileCount} affected file${fileCount === 1 ? '' : 's'}`}
          </button>

          {expanded && (
            <ul
              className={cn(
                'scrollbar-stealth max-h-32 overflow-y-auto rounded-[var(--radius-inner)]',
                'border border-border-subtle/30 bg-surface-sunken/40 px-2 py-1 font-mono text-meta'
              )}
            >
              {filePaths.map((path) => (
                <li key={path} className="truncate py-0.5 text-text-secondary" title={path}>
                  {path}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="vx-composer-dialog-sticky-footer mt-3 flex flex-col gap-2 border-t border-border-subtle/20 pt-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onDenyAll}>
              Deny all
            </Button>
            <Button size="sm" variant="secondary" onClick={onReviewOneByOne}>
              Review one by one
            </Button>
            <Button ref={approveAllRef} size="sm" variant="primary" onClick={onApproveAll}>
              Approve all
            </Button>
          </div>
        </div>
      </ComposerDialog>
    </ComposerDialogPortal>
  );
}
