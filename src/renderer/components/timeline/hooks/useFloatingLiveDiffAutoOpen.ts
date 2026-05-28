/**
 * Opens the floating live-diff panel for the tail in-flight edit tool call.
 */

import { useEffect } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { useFloatingLiveDiffStore } from '../../../store/useFloatingLiveDiffStore.js';
import { tailInFlightEditChildIndex, type Row } from '../reducer/deriveRows.js';

export function useFloatingLiveDiffAutoOpen(rows: Row[]): void {
  const liveDiffByCallId = useChatStore((s) => s.liveDiffByCallId);
  const open = useFloatingLiveDiffStore((s) => s.open);
  const close = useFloatingLiveDiffStore((s) => s.close);
  const userDismissedCallId = useFloatingLiveDiffStore((s) => s.userDismissedCallId);

  useEffect(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row?.kind !== 'tool-group' || row.toolName !== 'edit') continue;
      const idx = tailInFlightEditChildIndex(row.children);
      if (idx === null) continue;
      const child = row.children[idx];
      if (!child) continue;
      const diff =
        child.diffStream ??
        (child.callId ? liveDiffByCallId[child.callId] : undefined);
      if (!diff || diff.hunks.length === 0 || diff.settled === true) continue;
      if (userDismissedCallId === child.callId) {
        close();
        return;
      }
      open({
        callId: child.callId,
        filePath: diff.filePath,
        diffStream: diff
      });
      return;
    }
    close();
  }, [rows, liveDiffByCallId, open, close, userDismissedCallId]);
}
