/**
 * `useConversationProcessing` must:
 *   - return `{ isProcessing: false, runId: null }` for an unknown id,
 *   - reflect the slice's flags when the slice exists,
 *   - and (most importantly) NOT re-render the consumer when an
 *     unrelated slice mutates.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationProcessing } from '@renderer/hooks/chat/useConversationProcessing';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('useConversationProcessing', () => {
  it('returns idle for unknown ids', () => {
    const { result } = renderHook(() => useConversationProcessing('conv-missing'));
    expect(result.current).toEqual({
      isProcessing: false,
      awaitingAskUser: false,
      isRunActive: false,
      runId: null
    });
  });

  it('returns idle when id is null', () => {
    const { result } = renderHook(() => useConversationProcessing(null));
    expect(result.current).toEqual({
      isProcessing: false,
      awaitingAskUser: false,
      isRunActive: false,
      runId: null
    });
  });

  it('reflects the slice flags', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { result } = renderHook(() => useConversationProcessing('conv-A'));
    expect(result.current).toEqual({
      isProcessing: true,
      awaitingAskUser: false,
      isRunActive: true,
      runId: 'run-A'
    });
  });

  it('treats ask_user pause as run-active', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: false,
          awaitingAskUser: true,
          runStartedAt: 1
        })
      }
    });
    const { result } = renderHook(() => useConversationProcessing('conv-A'));
    expect(result.current).toEqual({
      isProcessing: false,
      awaitingAskUser: true,
      isRunActive: true,
      runId: 'run-A'
    });
  });

  it('does NOT re-render on unrelated-slice mutations', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        }),
        'conv-B': chatSliceFixture({
          conversationId: 'conv-B'
        })
      }
    });
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useConversationProcessing('conv-A');
    });
    const baseline = renderCount;
    expect(result.current).toEqual({
      isProcessing: true,
      awaitingAskUser: false,
      isRunActive: true,
      runId: 'run-A'
    });

    // Mutate conv-B's slice — same shape, different flag — and confirm
    // conv-A's consumer didn't re-render.
    act(() => {
      useChatStore.setState((s) => ({
        slices: {
          ...s.slices,
          'conv-B': { ...s.slices['conv-B']!, isProcessing: true, runId: 'run-B' }
        }
      }));
    });

    expect(renderCount).toBe(baseline);
    expect(result.current).toEqual({
      isProcessing: true,
      awaitingAskUser: false,
      isRunActive: true,
      runId: 'run-A'
    });
  });

  it('flips the consumer when its OWN slice transitions', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { result } = renderHook(() => useConversationProcessing('conv-A'));
    expect(result.current.isProcessing).toBe(true);

    act(() => {
      useChatStore.setState((s) => ({
        slices: {
          ...s.slices,
          'conv-A': { ...s.slices['conv-A']!, isProcessing: false, runId: null }
        }
      }));
    });

    expect(result.current).toEqual({
      isProcessing: false,
      awaitingAskUser: false,
      isRunActive: false,
      runId: null
    });
  });
});
