/**
 * Sub-agent lifecycle + streaming branches of the timeline reducer.
 * Extracted from `applyTimelineEvent.ts` to keep the main switch readable.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import {
  stampUsageStart,
  type AssistantTextAcc,
  type ReasoningTextAcc,
  type SubAgentSnapshot,
  type TimelineState
} from './types.js';
import {
  appendTimelineEvent,
  autoCloseReasoning,
  ensureSnapshot
} from './timelineReducerShared.js';

type SubagentStreamingEvent = Extract<
  TimelineEvent,
  {
    kind:
      | 'agent-text-delta'
      | 'agent-text-end'
      | 'agent-text-aborted'
      | 'agent-reasoning-delta'
      | 'agent-reasoning-end';
    subagentId?: string;
  }
> & { subagentId: string };

type SubagentLifecycleEvent = Extract<
  TimelineEvent,
  { kind: 'subagent-pending' | 'subagent-spawn' | 'subagent-status' | 'subagent-result' }
>;

export function applySubagentStreamingEvent(
  state: TimelineState,
  event: SubagentStreamingEvent
): TimelineState {
  const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
  switch (event.kind) {
    case 'agent-text-delta': {
      const existing = cur.assistantTexts[event.id];
      const firstSeen = !existing;
      const prev =
        existing ?? { id: event.id, text: '', done: false, startedAt: event.ts };
      const reasoningTexts = autoCloseReasoning(cur.reasoningTexts, event.id, event.ts);
      const usage = stampUsageStart(cur.usage, event.ts);
      const next: SubAgentSnapshot = {
        ...cur,
        reasoningTexts,
        assistantTexts: {
          ...cur.assistantTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        },
        iterationOrder:
          firstSeen && !cur.iterationOrder.includes(event.id)
            ? [...cur.iterationOrder, event.id]
            : cur.iterationOrder,
        ...(usage !== cur.usage ? { usage } : {})
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-text-end': {
      const prev = cur.assistantTexts[event.id];
      if (!prev) return state;
      const next: SubAgentSnapshot = {
        ...cur,
        assistantTexts: {
          ...cur.assistantTexts,
          [event.id]: { ...prev, done: true }
        }
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-text-aborted': {
      const { [event.id]: _droppedText, ...restText } = cur.assistantTexts;
      const { [event.id]: _droppedReasoning, ...restReasoning } = cur.reasoningTexts;
      void _droppedText;
      void _droppedReasoning;
      const next: SubAgentSnapshot = {
        ...cur,
        assistantTexts: restText,
        reasoningTexts: restReasoning,
        iterationOrder: cur.iterationOrder.filter((id: string) => id !== event.id)
      };
      return {
        ...state,
        events: state.events.filter(
          (e) =>
            !(
              (e.kind === 'agent-text-delta' ||
                e.kind === 'agent-reasoning-delta') &&
              e.id === event.id &&
              e.subagentId === event.subagentId
            )
        ),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-reasoning-delta': {
      const existing = cur.reasoningTexts[event.id];
      const firstSeen = !existing;
      const prev =
        existing ?? { id: event.id, text: '', done: false, startedAt: event.ts };
      const usage = stampUsageStart(cur.usage, event.ts);
      const next: SubAgentSnapshot = {
        ...cur,
        reasoningTexts: {
          ...cur.reasoningTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        },
        iterationOrder:
          firstSeen && !cur.iterationOrder.includes(event.id)
            ? [...cur.iterationOrder, event.id]
            : cur.iterationOrder,
        ...(usage !== cur.usage ? { usage } : {})
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-reasoning-end': {
      const prev = cur.reasoningTexts[event.id];
      if (!prev || prev.done) return state;
      const next: SubAgentSnapshot = {
        ...cur,
        reasoningTexts: {
          ...cur.reasoningTexts,
          [event.id]: { ...prev, done: true, endedAt: event.ts }
        }
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
  }
}

export function applySubagentLifecycleTimelineEvent(
  state: TimelineState,
  event: SubagentLifecycleEvent,
  mutate: boolean
): TimelineState {
  switch (event.kind) {
    case 'subagent-pending': {
      const existing = state.subagents[event.subagentId];
      const isTerminal =
        existing?.status === 'done' ||
        existing?.status === 'failed' ||
        existing?.status === 'aborted';
      if (existing && !isTerminal && existing.status !== 'pending') {
        return state;
      }
      const carryExisting = existing && !isTerminal;
      const next: SubAgentSnapshot = {
        id: event.subagentId,
        task: event.task,
        files: event.files,
        missingFiles: carryExisting ? existing.missingFiles : [],
        tools:
          (event.tools?.length ?? 0) > 0
            ? event.tools
            : carryExisting
              ? existing.tools
              : [],
        status: 'pending',
        startedAt: event.ts,
        steps: carryExisting ? existing.steps : [],
        fileEdits: carryExisting ? existing.fileEdits : [],
        assistantTexts: carryExisting ? existing.assistantTexts : {},
        reasoningTexts: carryExisting ? existing.reasoningTexts : {},
        iterationOrder: carryExisting ? existing.iterationOrder : [],
        partialToolCallArgs: carryExisting ? existing.partialToolCallArgs : {}
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'subagent-spawn': {
      const existing = state.subagents[event.subagentId];
      const next: SubAgentSnapshot = {
        id: event.subagentId,
        task: event.task || existing?.task || '',
        files: event.files.length > 0 ? event.files : existing?.files ?? [],
        missingFiles: event.missingFiles ?? existing?.missingFiles ?? [],
        tools: (event.tools?.length ?? 0) > 0 ? event.tools : existing?.tools ?? [],
        status: 'running',
        startedAt: existing?.startedAt ?? event.ts,
        steps: existing?.steps ?? [],
        fileEdits: existing?.fileEdits ?? [],
        assistantTexts: existing?.assistantTexts ?? {},
        reasoningTexts: existing?.reasoningTexts ?? {},
        iterationOrder: existing?.iterationOrder ?? [],
        partialToolCallArgs: existing?.partialToolCallArgs ?? {}
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'subagent-status': {
      const cur = state.subagents[event.subagentId];
      if (!cur) return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
      const { liveStatus: _prior, ...rest } = cur;
      void _prior;
      const closedTexts: Record<string, AssistantTextAcc> = {};
      for (const id of Object.keys(rest.assistantTexts)) {
        const t = rest.assistantTexts[id]!;
        closedTexts[id] = t.done ? t : { ...t, done: true };
      }
      const closedReasoning: Record<string, ReasoningTextAcc> = {};
      for (const id of Object.keys(rest.reasoningTexts)) {
        const r = rest.reasoningTexts[id]!;
        closedReasoning[id] = r.done ? r : { ...r, done: true, endedAt: r.endedAt ?? event.ts };
      }
      const isTerminal =
        event.status === 'done' ||
        event.status === 'partial' ||
        event.status === 'failed' ||
        event.status === 'malformed' ||
        event.status === 'aborted';
      const nextPartial =
        isTerminal && Object.keys(rest.partialToolCallArgs).length > 0
          ? {}
          : rest.partialToolCallArgs;
      const next: SubAgentSnapshot = {
        ...rest,
        status: event.status,
        endedAt: event.ts,
        assistantTexts: closedTexts,
        reasoningTexts: closedReasoning,
        partialToolCallArgs: nextPartial,
        ...(event.message !== undefined ? { message: event.message } : {})
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'subagent-result': {
      const cur = state.subagents[event.subagentId];
      if (!cur) return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        subagents: {
          ...state.subagents,
          [event.subagentId]: { ...cur, output: event.output }
        }
      };
    }
  }
}
