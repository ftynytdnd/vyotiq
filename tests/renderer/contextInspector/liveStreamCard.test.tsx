/**
 * Inspector live summary card — gold headline + streaming markdown body.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LiveStreamCard } from '@renderer/components/contextInspector/LiveStreamCard';
import { useChatStore } from '@renderer/store/useChatStore';
import type { ContextSummaryAcc } from '@renderer/components/timeline/reducer/types';

const SUMMARY_ID = 'sum-live-1';
const CONV_ID = 'conv-live-1';

const baseConfig = {
  summarizerSelection: { providerId: 'p', modelId: 'm' },
  trigger: 'auto' as const,
  droppedMarkerStyle: 'omit' as const
};

function makeSummary(overrides: Partial<ContextSummaryAcc> = {}): ContextSummaryAcc {
  return {
    summaryId: SUMMARY_ID,
    startedAt: 1,
    range: { startIdx: 0, endIdx: 2 },
    replacedMessageIds: ['m1'],
    droppedMessageIds: [],
    beforeTokens: 500,
    config: baseConfig,
    text: '',
    reasoningText: '',
    status: 'pending',
    undone: false,
    ...overrides
  };
}

beforeEach(() => {
  useChatStore.setState({
    slices: {
      [CONV_ID]: {
        conversationId: CONV_ID,
        runId: 'run-1',
        isProcessing: true,
        runStartedAt: 0,
        draft: '',
        events: [],
        assistantTexts: {},
        reasoningTexts: {},
        subagents: {},
        partialToolCallArgs: {},
        settledCallIds: {},
        liveDiffByCallId: {},
        toolResultSettledIds: {},
        summaries: {},
        messageOverrides: {}
      }
    },
    summaries: {}
  });
});

describe('LiveStreamCard', () => {
  it('uses gold headline while streaming', () => {
    useChatStore.setState({
      slices: {
        [CONV_ID]: {
          ...useChatStore.getState().slices[CONV_ID]!,
          summaries: {
            [SUMMARY_ID]: makeSummary({
              status: 'streaming',
              text: 'Compressing body…'
            })
          }
        }
      }
    });
    const { container } = render(
      <LiveStreamCard summaryId={SUMMARY_ID} conversationId={CONV_ID} />
    );
    expect(container.innerHTML).toContain('vx-timeline-phase-live');
    expect(container.textContent ?? '').toContain('Compressing 1 message');
  });

  it('renders streaming markdown for live body', () => {
    useChatStore.setState({
      slices: {
        [CONV_ID]: {
          ...useChatStore.getState().slices[CONV_ID]!,
          summaries: {
            [SUMMARY_ID]: makeSummary({
              status: 'streaming',
              text: '# Notes\n\nStill going'
            })
          }
        }
      }
    });
    const { container } = render(
      <LiveStreamCard summaryId={SUMMARY_ID} conversationId={CONV_ID} />
    );
    expect(container.querySelector('.vyotiq-stream-md')).not.toBeNull();
  });

  it('hands off to full markdown when ended', () => {
    useChatStore.setState({
      slices: {
        [CONV_ID]: {
          ...useChatStore.getState().slices[CONV_ID]!,
          summaries: {
            [SUMMARY_ID]: makeSummary({
              status: 'ended',
              finalText: '## Done\n\nSettled.',
              afterTokens: 100,
              savedPercent: 50
            })
          }
        }
      }
    });
    const { container } = render(
      <LiveStreamCard summaryId={SUMMARY_ID} conversationId={CONV_ID} />
    );
    expect(container.querySelector('.vyotiq-md')).not.toBeNull();
    expect(container.innerHTML).not.toContain('vyotiq-stream-cursor');
  });
});
