/**
 * Per-conversation run-progress scratchpad keys.
 *
 * The agent always addresses the note as `run-progress` via the `memory`
 * tool; the host maps that to `run-progress-<conversationId>.md` on disk so
 * progress from one chat never bleeds into another in the same workspace.
 */

/** Logical key the agent uses in `memory` tool calls. */
export const RUN_PROGRESS_AGENT_KEY = 'run-progress';

const STORAGE_PREFIX = `${RUN_PROGRESS_AGENT_KEY}-`;

/** On-disk note key for a conversation's run-progress scratchpad. */
export function runProgressStorageKey(conversationId: string): string {
  return `${STORAGE_PREFIX}${conversationId}`;
}

/**
 * Resolve the agent-facing `run-progress` key to the storage key for the
 * active conversation. Other keys pass through unchanged.
 */
export function resolveRunProgressKey(
  agentKey: string,
  conversationId: string | undefined
): string {
  if (agentKey === RUN_PROGRESS_AGENT_KEY) {
    if (!conversationId) return agentKey;
    return runProgressStorageKey(conversationId);
  }
  return agentKey;
}

/** True for the agent key or any per-conversation storage variant. */
export function isRunProgressKey(key: string): boolean {
  return key === RUN_PROGRESS_AGENT_KEY || key.startsWith(STORAGE_PREFIX);
}

/** True for per-conversation storage keys (hidden from workspace note lists). */
export function isPerConversationRunProgressKey(key: string): boolean {
  return key.startsWith(STORAGE_PREFIX);
}
