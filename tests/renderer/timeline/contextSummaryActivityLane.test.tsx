/**
 * Context summary rows render in the activity lane, not the whisper stream.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Timeline } from '@renderer/components/timeline/Timeline';
import { useChatStore } from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

function resetStore(): void {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    orchestratorUsage: undefined,
    runId: null,
    conversationId: 'c-ctx',
    isProcessing: false,
    runStartedAt: null
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
  resetStore();
});

describe('context summary activity lane', () => {
  it('renders context summary in activity lane outside whisper stream', () => {
    useChatStore.setState({
      conversationId: 'c-ctx',
      isProcessing: false,
      events: [
        { kind: 'user-prompt', id: 'p1', ts: 100, content: 'Summarize please' },
        { kind: 'context-summary-pending', summaryId: 'sum-1', ts: 200, replacedMessageIds: ['m1', 'm2'] },
        { kind: 'context-summary-end', summaryId: 'sum-1', ts: 300, beforeTokens: 1000, afterTokens: 400, savedPercent: 60 }
      ] satisfies TimelineEvent[],
      summaries: {
        'sum-1': {
          summaryId: 'sum-1',
          status: 'ended',
          replacedMessageIds: ['m1', 'm2'],
          text: 'Summary body',
          finalText: 'Summary body',
          reasoningText: '',
          beforeTokens: 1000,
          afterTokens: 400,
          savedPercent: 60,
          undone: false
        }
      }
    });

    const { container } = render(<Timeline />);

    const summaryRow = container.querySelector('[data-row-kind="context-summary"]');
    expect(summaryRow).not.toBeNull();
    expect(summaryRow?.closest('.timeline-activity-lane')).not.toBeNull();
    expect(summaryRow?.closest('.vx-timeline-deleg-weave')).toBeNull();
    expect(container.textContent ?? '').toContain('Compressed 2 messages');
  });
});
