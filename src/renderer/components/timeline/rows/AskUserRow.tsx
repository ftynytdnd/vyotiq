/**
 * Structured `ask_user` prompt — compact timeline row; overlay hosts interactive UI.
 */

import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
import { AskUserCompactRow } from './AskUserCompactRow.js';

interface AskUserRowProps {
  payload: AskUserStructuredPayload;
  displayText: string;
  promptEventId: string;
  toolCallId: string;
  runId: string;
  status?: 'pending' | 'submitted';
  source?: 'host-report-gate';
}

export function AskUserRow({ payload, displayText, promptEventId, status, source }: AskUserRowProps) {
  return (
    <AskUserCompactRow
      payload={payload}
      displayText={displayText}
      promptEventId={promptEventId}
      {...(status ? { status } : {})}
      {...(source ? { source } : {})}
    />
  );
}
