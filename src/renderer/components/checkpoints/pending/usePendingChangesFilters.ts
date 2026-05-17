/**
 * Per-conversation filter state for the pending-changes panel.
 *
 * Two filter axes:
 *   - `runId`     — when set, only entries with the matching run id
 *      survive. The header surfaces this only when ≥ 2 distinct
 *      runs are present in the pending list.
 *   - `pathQuery` — substring match against `filePath`
 *      (case-insensitive).
 *
 * State is local to the panel mount, NOT persisted: switching
 * conversations resets the filters because the new conversation's
 * runs and paths bear no relation to the previous one. The hook
 * re-initialises automatically when the `conversationId` reference
 * changes thanks to React's identity-based dependency tracking.
 */

import { useCallback, useEffect, useState } from 'react';

export interface PendingFiltersState {
  runId: string | null;
  pathQuery: string;
  setRunId: (id: string | null) => void;
  setPathQuery: (q: string) => void;
  reset: () => void;
}

export function usePendingChangesFilters(
  conversationId: string | null
): PendingFiltersState {
  const [runId, setRunId] = useState<string | null>(null);
  const [pathQuery, setPathQuery] = useState('');

  const reset = useCallback(() => {
    setRunId(null);
    setPathQuery('');
  }, []);

  // Reset filters when the active conversation flips. Without this
  // a stale `runId` from an old conversation could exclude every
  // entry in the new conversation, leaving the panel mysteriously
  // empty.
  useEffect(() => {
    reset();
  }, [conversationId, reset]);

  return { runId, pathQuery, setRunId, setPathQuery, reset };
}
