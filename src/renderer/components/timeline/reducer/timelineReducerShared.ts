/**
 * Shared pure helpers for the timeline reducer modules. Extracted
 * from `applyTimelineEvent.ts` so sub-agent branches can live in
 * focused files without duplicating the append
 * and partial-args reconciliation logic.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import type {
  PartialToolCallArgs,
  ReasoningTextAcc,
  SubAgentSnapshot,
  SubAgentStep
} from './types.js';

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

export function ensureSnapshot(
  byId: Record<string, SubAgentSnapshot>,
  id: string,
  ts: number
): SubAgentSnapshot {
  const existing = byId[id];
  if (existing) return existing;
  return {
    id,
    task: '',
    files: [],
    missingFiles: [],
    tools: [],
    unknownTools: [],
    status: 'running',
    startedAt: ts,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {}
  };
}

export function upsertStep(
  steps: SubAgentStep[],
  patch: { callId: string; call?: ToolCall; result?: ToolResult; ts: number }
): SubAgentStep[] {
  const idx = steps.findIndex((s) => s.callId === patch.callId);
  if (idx === -1) {
    const next: SubAgentStep = {
      callId: patch.callId,
      startedAt: patch.ts,
      ...(patch.call ? { call: patch.call } : {}),
      ...(patch.result ? { result: patch.result, endedAt: patch.ts } : {})
    };
    return [...steps, next];
  }
  const cur = steps[idx]!;
  const merged: SubAgentStep = {
    ...cur,
    ...(patch.call ? { call: patch.call } : {}),
    ...(patch.result ? { result: patch.result, endedAt: cur.endedAt ?? patch.ts } : {})
  };
  return steps.map((s, i) => (i === idx ? merged : s));
}
