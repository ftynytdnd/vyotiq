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
}

export function AskUserRow({ payload, displayText, promptEventId, status }: AskUserRowProps) {
  return (
    <AskUserCompactRow
      payload={payload}
      displayText={displayText}
      promptEventId={promptEventId}
      {...(status ? { status } : {})}
    />
  );
}
