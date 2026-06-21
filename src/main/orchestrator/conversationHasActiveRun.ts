/**
 * Shared helper — whether a conversation has an in-flight orchestrator run.
 */

import type { ContextLevel } from '@shared/context/contextLevel.js';
import { listActiveRuns } from './AgentV.js';

const contextLevelByConversation = new Map<string, ContextLevel>();

export function conversationHasActiveRun(conversationId: string): boolean {
  return listActiveRuns().some((r) => r.conversationId === conversationId);
}

/** Latest context pressure for an active run (heartbeat deferral). */
export function setActiveRunContextLevel(conversationId: string, level: ContextLevel): void {
  if (conversationId) contextLevelByConversation.set(conversationId, level);
}

export function getActiveRunContextLevel(conversationId: string): ContextLevel | undefined {
  return contextLevelByConversation.get(conversationId);
}

export function clearActiveRunContextLevel(conversationId: string): void {
  if (conversationId) contextLevelByConversation.delete(conversationId);
}

/** Test-only: reset tracked context levels. */
export function __test_resetActiveRunContextLevels(): void {
  contextLevelByConversation.clear();
}
