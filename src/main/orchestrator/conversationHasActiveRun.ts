/**
 * Shared helper — whether a conversation has an in-flight orchestrator run.
 */

import { listActiveRuns } from './AgentV.js';

export function conversationHasActiveRun(conversationId: string): boolean {
  return listActiveRuns().some((r) => r.conversationId === conversationId);
}
