/**
 * ContextInspectorBody — regression: stable Zustand selectors must not
 * trigger React error #185 (maximum update depth) when summaries are
 * absent from the chat slice.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ContextInspectorBody } from '@renderer/components/contextInspector/ContextInspectorPanel';
import { useChatStore } from '@renderer/store/useChatStore';
import { useContextSummaryStore } from '@renderer/store/useContextSummaryStore';

const MOCK_SNAPSHOT = {
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  runId: 'run-1',
  totalTokens: 1000,
  currentRatio: 0.1,
  ceiling: 128000,
  messages: [],
  activeSummaryId: undefined,
  framing: {
    systemPromptTokens: 100,
    toolSchemaTokens: 50,
    bodyTokens: 850,
    total: 1000,
    envelopes: []
  }
};

const MOCK_RULES = {
  autoTriggerRatio: 0.85,
  manualTriggerEnabled: true,
  keepRecentTurns: 2
};

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    contextSummary: {
      inspect: vi.fn(async () => MOCK_SNAPSHOT),
      getRules: vi.fn(async () => MOCK_RULES),
      onSnapshotChanged: vi.fn(() => () => {})
    }
  }
}));

beforeEach(() => {
  useChatStore.setState({
    conversationId: 'conv-1',
    slices: {
      'conv-1': {
        events: [],
        subagents: {},
        summaries: undefined as unknown as Record<string, never>,
        assistantTexts: {},
        reasoningTexts: {},
        partialToolCallArgs: {},
        orchestratorUsage: undefined,
        messageOverrides: {},
        latestOrchestratorRunStatus: undefined,
        runStartedAt: null,
        isProcessing: false
      }
    }
  } as never);

  useContextSummaryStore.setState({
    boundId: 'run-1',
    mode: 'live',
    snapshot: MOCK_SNAPSHOT,
    rules: MOCK_RULES,
    loading: false,
    error: null,
    unsubscribe: null,
    busy: false
  } as never);
});

describe('ContextInspectorBody', () => {
  it('survives rapid chat-store token-usage churn without infinite re-renders', async () => {
    const { container } = render(<ContextInspectorBody />);

    await act(async () => {
      for (let i = 0; i < 50; i++) {
        useChatStore.setState((s) => ({
          slices: {
            ...s.slices,
            'conv-1': {
              ...s.slices['conv-1']!,
              orchestratorUsage: {
                latest: {
                  promptTokens: 100 + i,
                  completionTokens: 200 + i,
                  totalTokens: 300 + i * 2
                },
                peak: {
                  promptTokens: 100 + i,
                  completionTokens: 200 + i,
                  totalTokens: 300 + i * 2
                },
                streamStartedAt: 1,
                streamEndedAt: 2
              }
            }
          }
        }));
      }
    });

    expect(container.textContent ?? '').toContain('Wire breakdown');
  });
});
