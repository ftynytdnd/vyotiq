/**
 * Context summary row — markdown rendering for preview and expanded body.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { ContextSummaryRow } from '@renderer/components/timeline/rows/ContextSummaryRow';
import { useChatStore } from '@renderer/store/useChatStore';
import type { ContextSummaryAcc } from '@renderer/components/timeline/reducer/types';

const SUMMARY_ID = 'sum-1';

const baseConfig = {
  summarizerSelection: { providerId: 'p', modelId: 'm' },
  trigger: 'auto' as const,
  droppedMarkerStyle: 'omit' as const
};

function makeSummary(overrides: Partial<ContextSummaryAcc> = {}): ContextSummaryAcc {
  return {
    summaryId: SUMMARY_ID,
    startedAt: 1,
    range: { startIdx: 0, endIdx: 4 },
    replacedMessageIds: ['m1', 'm2'],
    droppedMessageIds: [],
    beforeTokens: 1000,
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
    conversationId: 'conv-1',
    runId: 'run-1',
    summaries: {}
  });
});

describe('ContextSummaryRow markdown', () => {
  it('renders gold headline while compressing', () => {
    useChatStore.setState({
      summaries: {
        [SUMMARY_ID]: makeSummary({
          status: 'streaming',
          text: 'Still writing…'
        })
      }
    });
    const { container } = render(<ContextSummaryRow summaryId={SUMMARY_ID} live />);
    expect(container.innerHTML).toContain('vx-timeline-phase-live');
    expect(container.textContent ?? '').toContain('Compressing 2 messages');
  });

  it('renders settled expanded body through MarkdownBody', async () => {
    useChatStore.setState({
      summaries: {
        [SUMMARY_ID]: makeSummary({
          status: 'ended',
          finalText: '## Summary\n\nDone.',
          afterTokens: 200,
          savedPercent: 80
        })
      }
    });
    const { container } = render(<ContextSummaryRow summaryId={SUMMARY_ID} />);
    const toggle = container.querySelector('button[aria-label*="Expand"]');
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle!.click();
    });
    expect(container.textContent ?? '').toContain('Summary');
    expect(container.querySelector('.vyotiq-md, .vx-timeline-md')).not.toBeNull();
  });

  it('renders streaming partial markdown in collapsed preview', () => {
    useChatStore.setState({
      summaries: {
        [SUMMARY_ID]: makeSummary({
          status: 'streaming',
          text: '# Live\n\nPartial **bold**'
        })
      }
    });
    const { container } = render(<ContextSummaryRow summaryId={SUMMARY_ID} live />);
    expect(container.querySelector('.vyotiq-stream-md')).not.toBeNull();
  });
});
