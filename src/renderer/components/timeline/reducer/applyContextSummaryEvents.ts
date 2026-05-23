/**
 * Context-summary + override branches of the timeline reducer.
 * Extracted from `applyTimelineEvent.ts` to keep the main switch readable.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { TimelineState } from './types.js';
import { appendTimelineEvent } from './timelineReducerShared.js';

type ContextSummaryEvent = Extract<
  TimelineEvent,
  {
    kind:
      | 'context-summary-pending'
      | 'context-summary-delta'
      | 'context-summary-reasoning-delta'
      | 'context-summary-end'
      | 'context-summary-aborted'
      | 'context-summary-undone'
      | 'context-override-set';
  }
>;

export function applyContextSummaryTimelineEvent(
  state: TimelineState,
  event: ContextSummaryEvent,
  mutate: boolean
): TimelineState {
  switch (event.kind) {
    case 'context-summary-pending': {
      const acc = {
        summaryId: event.summaryId,
        startedAt: event.ts,
        range: event.range,
        replacedMessageIds: event.replacedMessageIds,
        droppedMessageIds: event.droppedMessageIds,
        beforeTokens: event.beforeTokens,
        config: event.config,
        text: '',
        reasoningText: '',
        status: 'pending' as const,
        undone: false
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: acc }
      };
    }

    case 'context-summary-delta': {
      const prev = state.summaries[event.summaryId];
      if (!prev) return state;
      if (prev.status === 'ended' || prev.status === 'aborted') return state;
      const next = {
        ...prev,
        text: prev.text + event.delta,
        status: 'streaming' as const,
        ...(prev.textStartedAt === undefined ? { textStartedAt: event.ts } : {})
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-reasoning-delta': {
      const prev = state.summaries[event.summaryId];
      if (!prev) return state;
      if (prev.status === 'ended' || prev.status === 'aborted') return state;
      const next = {
        ...prev,
        reasoningText: prev.reasoningText + event.delta,
        status: prev.status === 'pending' ? ('streaming' as const) : prev.status,
        ...(prev.reasoningStartedAt === undefined
          ? { reasoningStartedAt: event.ts }
          : {})
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-end': {
      const prev = state.summaries[event.summaryId];
      if (!prev) {
        return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
      }
      const next = {
        ...prev,
        status: 'ended' as const,
        finalText: event.finalText,
        afterTokens: event.afterTokens,
        savedPercent: event.savedPercent
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-aborted': {
      const prev = state.summaries[event.summaryId];
      if (!prev) {
        return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
      }
      const next = {
        ...prev,
        status: 'aborted' as const,
        reason: event.reason
      };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-undone': {
      const prev = state.summaries[event.summaryId];
      if (!prev) {
        return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
      }
      const next = { ...prev, undone: true };
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-override-set': {
      let nextOverrides: Record<string, import('@shared/types/contextSummary.js').ContextMessageOverride>;
      if (event.messageId === '*') {
        nextOverrides = {};
      } else if (event.override === null) {
        if (!(event.messageId in state.messageOverrides)) {
          return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
        }
        const { [event.messageId]: _drop, ...rest } = state.messageOverrides;
        void _drop;
        nextOverrides = rest;
      } else {
        if (state.messageOverrides[event.messageId] === event.override) {
          return { ...state, events: appendTimelineEvent(state.events, event, mutate) };
        }
        nextOverrides = {
          ...state.messageOverrides,
          [event.messageId]: event.override
        };
      }
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        messageOverrides: nextOverrides
      };
    }
  }
}
