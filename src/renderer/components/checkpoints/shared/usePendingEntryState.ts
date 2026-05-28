/**
 * Resolve a pending checkpoint entry for inline Accept/Reject actions.
 */

import { useMemo } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useCheckpointsStore } from '../../../store/useCheckpointsStore.js';

const EMPTY_PENDING: PendingChange[] = [];

interface PendingEntryLookup {
  entryId?: string;
  filePath?: string;
  runId?: string;
  subagentId?: string;
}

export function usePendingEntryState(lookup: PendingEntryLookup): PendingChange | null {
  const conversationId = useChatStore((s) => s.conversationId);
  const pending = useCheckpointsStore((s) => {
    if (!conversationId) return EMPTY_PENDING;
    return s.pendingByConversation[conversationId] ?? EMPTY_PENDING;
  });

  return useMemo(() => {
    if (lookup.entryId) {
      return pending.find((p) => p.entryId === lookup.entryId) ?? null;
    }
    if (!lookup.filePath) return null;
    let matches = pending.filter((p) => p.filePath === lookup.filePath);
    if (matches.length === 0) return null;
    if (lookup.runId) {
      const byRun = matches.filter((p) => p.runId === lookup.runId);
      if (byRun.length > 0) matches = byRun;
    }
    if (lookup.subagentId) {
      const byAgent = matches.filter((p) => p.subagentId === lookup.subagentId);
      if (byAgent.length > 0) matches = byAgent;
    }
    return matches[matches.length - 1] ?? null;
  }, [pending, lookup.entryId, lookup.filePath, lookup.runId, lookup.subagentId]);
}
