/**
 * Shared pure helpers for the timeline reducer modules.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { PartialToolCallArgs, ReasoningTextAcc } from './types.js';

/** Append `event` immutably or mutably — see `ApplyEventOptions.mutateEvents`. */
export function appendTimelineEvent(
  events: TimelineEvent[],
  event: TimelineEvent,
  mutate: boolean
): TimelineEvent[] {
  if (mutate) {
    events.push(event);
    return events;
  }
  return [...events, event];
}

export function autoCloseReasoning(
  reasoningTexts: Record<string, ReasoningTextAcc>,
  id: string,
  ts: number
): Record<string, ReasoningTextAcc> {
  const prev = reasoningTexts[id];
  if (!prev || prev.done) return reasoningTexts;
  return {
    ...reasoningTexts,
    [id]: { ...prev, done: true, endedAt: ts }
  };
}

/** Close every open reasoning stream except `exceptId` (if set). */
export function closeAllOpenReasoning(
  reasoningTexts: Record<string, ReasoningTextAcc>,
  ts: number,
  exceptId?: string
): Record<string, ReasoningTextAcc> {
  let next: Record<string, ReasoningTextAcc> | null = null;
  for (const [id, acc] of Object.entries(reasoningTexts)) {
    if (acc.done || id === exceptId) continue;
    if (!next) next = { ...reasoningTexts };
    next[id] = { ...acc, done: true, endedAt: ts };
  }
  return next ?? reasoningTexts;
}

export function clearPartialFor(
  prior: Record<string, PartialToolCallArgs>,
  realCallId: string,
  owner: string
): Record<string, PartialToolCallArgs> {
  if (realCallId in prior) {
    const { [realCallId]: _drop, ...rest } = prior;
    void _drop;
    return rest;
  }
  const surrogatePrefix = `pending:${owner}:`;
  let lowestKey: string | null = null;
  let lowestIndex = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(prior)) {
    if (!key.startsWith(surrogatePrefix)) continue;
    const entry = prior[key]!;
    if (entry.index < lowestIndex) {
      lowestIndex = entry.index;
      lowestKey = key;
    }
  }
  if (lowestKey === null) return prior;
  const { [lowestKey]: _drop, ...rest } = prior;
  void _drop;
  return rest;
}
