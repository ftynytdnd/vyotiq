/**
 * ConfirmHost — subscribes to `tools:request-confirm` IPC events from the
 * main process and surfaces each one through the appropriate dialog.
 *
 * Two render branches:
 *   - `payload?.kind === 'edit-approval'` → `EditApprovalDialog`
 *     (full diff preview, three buttons: Deny / Accept / Accept all
 *     remaining).
 *   - Otherwise → legacy `ConfirmDialog` (text-only Approve / Deny).
 *
 * Requests are queued in arrival order so a burst of confirms never
 * overlap; the user answers them one at a time.
 *
 * Server-side cancellation: when the main process resolves a pending
 * request without a renderer reply (server-side timeout, shutdown drain),
 * it broadcasts on `tools:cancel-confirm`. The host drops the matching
 * entry from the queue so the modal never lingers stale.
 */

import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { EditApprovalDialog } from './EditApprovalDialog.js';
import { vyotiq } from '../../lib/ipc.js';
import type { ConfirmRequest, ConfirmResponse } from '@shared/types/ipc.js';

export function ConfirmHost() {
  // Queue of pending confirm requests, including their optional rich
  // payload. We use the shared `ConfirmRequest` type from
  // `@shared/types/ipc.js` so the wire shape is the single source of
  // truth.
  const [pending, setPending] = useState<ConfirmRequest[]>([]);

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

  // Pop-and-answer with two layered guards:
  //
  //   1. The functional `setPending` updater reads `p[0]` from the
  //      CURRENT queue (not the stale closure-captured `pending`),
  //      so a rapid double-click on the same head pops both A and B
  //      in order rather than popping A twice. React passes the
  //      result of one updater to the next within the same tick, so
  //      sibling updaters from rapid clicks see different queues.
  //
  //   2. `respondedIdsRef` is a render-stable set of ids we have
  //      already dispatched an IPC for. React StrictMode invokes
  //      each updater twice in development to flush out impure
  //      writes; the side-effect inside the updater would otherwise
  //      fire `respondConfirm` twice for the same id (harmless —
  //      `settleConfirm` is idempotent — but it spams "unknown id"
  //      debug logs and trips the React purity contract). The ref
  //      gate makes the IPC dispatch idempotent at the updater
  //      level so the double-invocation is a no-op on the second
  //      pass. Review finding H7.
  //
  // Why the side-effect lives INSIDE the updater rather than after a
  // plain `setPending(p => p.slice(1))`: the alternative reads
  // `pending[0]` from the outer closure, which is stale for a
  // synchronous double-click within one render tick and loses the
  // atomic pop-vs-answer correspondence (the earlier bug this code
  // was originally written to defend against).
  const respondedIdsRef = useRef<Set<string>>(new Set());
  const respond = (reply: ConfirmResponse) => {
    setPending((p) => {
      const head = p[0];
      if (!head) return p;
      if (!respondedIdsRef.current.has(head.id)) {
        respondedIdsRef.current.add(head.id);
        void vyotiq.tools.respondConfirm(head.id, reply);
      }
      return p.slice(1);
    });
  };

  const head = pending[0];
  const queuedBehind = Math.max(0, pending.length - 1);

  // Edit-approval branch. The richer dialog ignores `message` and
  // reads everything from `payload`.
  if (head?.payload?.kind === 'edit-approval') {
    return (
      <EditApprovalDialog
        open
        payload={head.payload}
        queuedBehind={queuedBehind}
        onApprove={() => respond({ approved: true })}
        onApproveAll={() => respond({ approved: true, acceptAllRemaining: true })}
        onDeny={() => respond(false)}
      />
    );
  }

  // Legacy text-only branch — unchanged behavior + title.
  const title =
    queuedBehind > 0
      ? `Confirmation required (+${queuedBehind} queued)`
      : 'Confirmation required';
  return (
    <ConfirmDialog
      open={!!head}
      title={title}
      message={head?.message ?? ''}
      confirmLabel="Approve"
      cancelLabel="Deny"
      variant="primary"
      onConfirm={() => respond(true)}
      onCancel={() => respond(false)}
    />
  );
}
