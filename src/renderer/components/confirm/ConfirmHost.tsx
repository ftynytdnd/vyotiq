/**
 * ConfirmHost — subscribes to `tools:request-confirm` IPC events from the
 * main process and surfaces each one through the appropriate dialog.
 *
 * Two render branches:
 *   - `payload?.kind === 'edit-approval'` → `EditApprovalDialog` or
 *     {@link BatchEditApprovalDialog} when the queue exceeds the batch
 *     threshold.
 *   - Otherwise → composer `DestructiveConfirm` (text-only Approve / Deny).
 *
 * Requests are queued in arrival order so a burst of confirms never
 * overlap; the user answers them one at a time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DestructiveConfirm } from '../ui/DestructiveConfirm.js';
import {
  BatchEditApprovalDialog,
  EDIT_APPROVAL_BATCH_THRESHOLD
} from './BatchEditApprovalDialog.js';
import { EditApprovalDialog } from './EditApprovalDialog.js';
import { vyotiq } from '../../lib/ipc.js';
import type { ConfirmRequest, ConfirmResponse } from '@shared/types/ipc.js';

function isEditApproval(req: ConfirmRequest): boolean {
  return req.payload?.kind === 'edit-approval';
}

export function ConfirmHost() {
  const [pending, setPending] = useState<ConfirmRequest[]>([]);
  const [reviewOneByOne, setReviewOneByOne] = useState(false);

  useEffect(() => {
    const offRequest = vyotiq.tools.onConfirmRequest((req) =>
      setPending((p) => [
        ...p,
        {
          id: req.id,
          message: req.message,
          ...(req.payload ? { payload: req.payload } : {})
        }
      ])
    );
    const offCancel = vyotiq.tools.onConfirmCancel((id) =>
      setPending((p) => p.filter((r) => r.id !== id))
    );
    return () => {
      offRequest();
      offCancel();
    };
  }, []);

  const respondedIdsRef = useRef<Set<string>>(new Set());

  const respond = useCallback((reply: ConfirmResponse) => {
    setPending((p) => {
      const head = p[0];
      if (!head) return p;
      if (!respondedIdsRef.current.has(head.id)) {
        respondedIdsRef.current.add(head.id);
        void vyotiq.tools.respondConfirm(head.id, reply);
      }
      return p.slice(1);
    });
  }, []);

  const respondToId = useCallback((id: string, reply: ConfirmResponse) => {
    if (!respondedIdsRef.current.has(id)) {
      respondedIdsRef.current.add(id);
      void vyotiq.tools.respondConfirm(id, reply);
    }
    setPending((p) => p.filter((r) => r.id !== id));
  }, []);

  const editQueue = pending.filter(isEditApproval);
  const editCount = editQueue.length;
  const showBatchSummary =
    editCount >= EDIT_APPROVAL_BATCH_THRESHOLD &&
    editCount === pending.length &&
    !reviewOneByOne;

  // Reset one-by-one mode when the edit queue drains.
  useEffect(() => {
    if (editCount < EDIT_APPROVAL_BATCH_THRESHOLD) {
      setReviewOneByOne(false);
    }
  }, [editCount]);

  const denyAllEdits = useCallback(() => {
    for (const req of editQueue) {
      respondToId(req.id, false);
    }
    setReviewOneByOne(false);
  }, [editQueue, respondToId]);

  const approveAllEdits = useCallback(() => {
    const latchedRuns = new Set<string>();
    for (const req of editQueue) {
      const runId = req.payload?.kind === 'edit-approval' ? req.payload.runId : '';
      const useLatch = runId.length > 0 && !latchedRuns.has(runId);
      if (useLatch) latchedRuns.add(runId);
      respondToId(
        req.id,
        useLatch ? { approved: true, acceptAllRemaining: true } : { approved: true }
      );
    }
    setReviewOneByOne(false);
  }, [editQueue, respondToId]);

  if (showBatchSummary) {
    return (
      <BatchEditApprovalDialog
        pending={pending}
        onDenyAll={denyAllEdits}
        onApproveAll={approveAllEdits}
        onReviewOneByOne={() => setReviewOneByOne(true)}
      />
    );
  }

  const head = pending[0];
  const editIndex = head ? editQueue.findIndex((r) => r.id === head.id) : -1;
  const queuePosition = editIndex >= 0 ? editIndex + 1 : 1;
  const queueTotal = editCount > 0 ? editCount : pending.length;
  const queuedBehind = Math.max(0, (editIndex >= 0 ? editCount : pending.length) - queuePosition);
  const nextInQueue = pending[1] ?? null;

  if (head?.payload?.kind === 'edit-approval') {
    const queueAnnouncement =
      queueTotal > 1
        ? `Edit approval ${queuePosition} of ${queueTotal}`
        : 'Edit approval';
    return (
      <EditApprovalDialog
        open
        payload={head.payload}
        queuePosition={queuePosition}
        queueTotal={queueTotal}
        queuedBehind={queuedBehind}
        nextInQueue={nextInQueue}
        queueAnnouncement={queueAnnouncement}
        onApprove={() => respond({ approved: true })}
        onApproveAll={() => respond({ approved: true, acceptAllRemaining: true })}
        onDeny={() => respond(false)}
      />
    );
  }

  const title =
    queuedBehind > 0
      ? `Confirmation required (+${queuedBehind} queued)`
      : 'Confirmation required';
  return (
    <DestructiveConfirm
      variant="composer"
      open={!!head}
      title={title}
      message={head?.message ?? ''}
      confirmLabel="Approve"
      cancelLabel="Deny"
      tone="primary"
      onConfirm={() => respond(true)}
      onCancel={() => respond(false)}
    />
  );
}
