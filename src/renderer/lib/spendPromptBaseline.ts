/**
 * Tracks user-prompt ids loaded from disk so run-complete spend recording
 * does not re-count historical turns after app restart.
 */

import type { TimelineEvent } from '@shared/types/chat.js';

const baselineByConversation = new Map<string, Set<string>>();

function userPromptIds(events: readonly TimelineEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind === 'user-prompt') out.add(e.id);
  }
  return out;
}

/** Replace baseline for a conversation after a full transcript hydrate. */
export function syncSpendPromptBaseline(
  conversationId: string,
  events: readonly TimelineEvent[]
): void {
  baselineByConversation.set(conversationId, userPromptIds(events));
}

/** Extend baseline when older transcript pages are prepended. */
export function mergeSpendPromptBaseline(
  conversationId: string,
  events: readonly TimelineEvent[]
): void {
  const existing = baselineByConversation.get(conversationId) ?? new Set<string>();
  for (const id of userPromptIds(events)) existing.add(id);
  baselineByConversation.set(conversationId, existing);
}

export function clearSpendPromptBaseline(conversationId: string): void {
  baselineByConversation.delete(conversationId);
}

/** True when this prompt was already on disk before the current live session. */
export function isPersistedSpendPrompt(
  conversationId: string | null | undefined,
  promptId: string
): boolean {
  if (!conversationId) return false;
  return baselineByConversation.get(conversationId)?.has(promptId) ?? false;
}

/** Test-only reset. */
export function __test_resetSpendPromptBaseline(): void {
  baselineByConversation.clear();
}
