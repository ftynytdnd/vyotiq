/**
 * TurnStickyFooter — live throughput vs cumulative token fallback.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnStickyFooter } from '@renderer/components/timeline/shared/TurnStickyFooter';
import { useChatStore } from '@renderer/store/useChatStore';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  useChatStore.setState({
    isProcessing: true,
    awaitingAskUser: false,
    events: [
      {
        kind: 'user-prompt',
        id: 'p1',
        ts: 8_000,
        content: 'hi',
        runId: 'r1'
      }
    ],
    orchestratorUsage: {
      latest: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 },
      peak: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 },
      cumulative: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 },
      samples: 1,
      inFlight: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    },
    latestOrchestratorRunStatus: undefined,
    reasoningTexts: {
      'reason-1': {
        id: 'reason-1',
        text: 'thinking',
        done: false,
        startedAt: 9_000
      }
    },
    assistantTexts: {},
    partialToolCallArgs: {},
    toolResultSettledIds: {}
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TurnStickyFooter throughput', () => {
  it('falls back to cumulative tok when rate is not yet measurable', () => {
    render(
      <TurnStickyFooter live promptId="p1">
        <div>body</div>
      </TurnStickyFooter>
    );

    expect(screen.getByText(/Thinking/)).toBeTruthy();
    expect(screen.getByText(/1k run total/)).toBeTruthy();
  });

  it('shows live tok/s instead of cumulative total while streaming', () => {
    useChatStore.setState({
      orchestratorUsage: {
        latest: { promptTokens: 1000, completionTokens: 10, totalTokens: 1010 },
        peak: { promptTokens: 1000, completionTokens: 10, totalTokens: 1010 },
        cumulative: { promptTokens: 1000, completionTokens: 10, totalTokens: 1010 },
        samples: 1,
        inFlight: { promptTokens: 0, completionTokens: 40, totalTokens: 40 }
      }
    });

    const { rerender } = render(
      <TurnStickyFooter live promptId="p1">
        <div>body</div>
      </TurnStickyFooter>
    );

    vi.advanceTimersByTime(300);
    rerender(
      <TurnStickyFooter live promptId="p1">
        <div>body</div>
      </TurnStickyFooter>
    );

    useChatStore.setState({
      orchestratorUsage: {
        latest: { promptTokens: 1000, completionTokens: 10, totalTokens: 1010 },
        peak: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050 },
        cumulative: { promptTokens: 1000, completionTokens: 50, totalTokens: 1050 },
        samples: 2,
        inFlight: { promptTokens: 0, completionTokens: 50, totalTokens: 50 }
      }
    });

    vi.advanceTimersByTime(600);
    rerender(
      <TurnStickyFooter live promptId="p1">
        <div>body</div>
      </TurnStickyFooter>
    );

    expect(screen.getByText(/tok\/s/)).toBeTruthy();
    expect(screen.queryByText(/1k run total/)).toBeNull();
  });
});
