/** Shared helpers for inline delegation stream rendering. */

import type { SubAgentSnapshot } from '../reducer/types.js';

export function workerDisplayTag(
  subagentId: string,
  snap?: SubAgentSnapshot | null
): string {
  const id = snap?.id?.trim();
  return id && id.length > 0 ? id : subagentId;
}

export function isWorkerFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'malformed' || status === 'aborted';
}

/** Inline status suffix for worker tags — kept short per AGENTS.md. */
export function workerStatusSuffix(status: string): string | null {
  if (status === 'queued') return 'queued';
  if (status === 'pending' || status === 'running') return 'running';
  if (status === 'partial') return 'partial';
  if (isWorkerFailedStatus(status)) return 'failed';
  return null;
}

export function isWorkerPartialStatus(status: string): boolean {
  return status === 'partial';
}
