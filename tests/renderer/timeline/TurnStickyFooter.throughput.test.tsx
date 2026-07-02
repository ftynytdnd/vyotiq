/**
 * TurnStickyFooter — throughput hidden until long-turn threshold.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TurnStickyFooter } from '@renderer/components/timeline/shared/TurnStickyFooter';
import { useChatStore } from '@renderer/store/useChatStore';
import { LONG_TURN_WARN_MS } from '@shared/timeline/longTurnThresholds.js';

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
  it('omits token throughput on short turns', () => {
    render(
      <TurnStickyFooter live promptId="p1">
        <div>body</div>
      </TurnStickyFooter>
    );

    expect(screen.getByText(/Thinking/)).toBeTruthy();
    expect(screen.queryByText(/1k run total/)).toBeNull();
    expect(screen.queryByText(/tok\/s/)).toBeNull();
  });

  it('shows live tok/s after the long-turn threshold', () => {
    useChatStore.setState({
      events: [
        {
          kind: 'user-prompt',
          id: 'p1',
          ts: 10_000 - LONG_TURN_WARN_MS - 5_000,
          content: 'hi',
          runId: 'r1'
        }
      ],
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
