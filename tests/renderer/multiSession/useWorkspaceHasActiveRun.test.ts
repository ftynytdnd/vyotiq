/**
 * `useWorkspaceHasActiveRun` folds `useChatStore.slices` against
 * `useConversationsStore.list` and returns `true` iff at least one
 * conversation in the given workspace has an in-flight slice.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceHasActiveRun } from '@renderer/hooks/chat/useWorkspaceHasActiveRun';
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
  useConversationsStore.setState({
    list: [
      { id: 'conv-A1', title: 'A1', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-A' },
      { id: 'conv-A2', title: 'A2', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-A' },
      { id: 'conv-B1', title: 'B1', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-B' }
    ],
    activeIdByWorkspace: {},
    hydratedIds: new Set<string>(),
    loading: false
  });
});

describe('useWorkspaceHasActiveRun', () => {
  it('returns false when no slices exist', () => {
    const { result } = renderHook(() => useWorkspaceHasActiveRun('ws-A'));
    expect(result.current).toBe(false);
  });

  it('returns false when null workspaceId', () => {
    const { result } = renderHook(() => useWorkspaceHasActiveRun(null));
    expect(result.current).toBe(false);
  });

  it('returns true when ANY child of the workspace is processing', () => {
    useChatStore.setState({
      slices: {
        'conv-A2': chatSliceFixture({
          conversationId: 'conv-A2',
          runId: 'run-A2',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { result } = renderHook(() => useWorkspaceHasActiveRun('ws-A'));
    expect(result.current).toBe(true);
  });

  it('does not bleed across workspaces', () => {
    useChatStore.setState({
      slices: {
        'conv-B1': chatSliceFixture({
          conversationId: 'conv-B1',
          runId: 'run-B1',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { result: a } = renderHook(() => useWorkspaceHasActiveRun('ws-A'));
    const { result: b } = renderHook(() => useWorkspaceHasActiveRun('ws-B'));
    expect(a.current).toBe(false);
    expect(b.current).toBe(true);
  });

  it('returns true when a child is paused for ask_user', () => {
    useChatStore.setState({
      slices: {
        'conv-A1': chatSliceFixture({
          conversationId: 'conv-A1',
          runId: 'run-A1',
          isProcessing: false,
          awaitingAskUser: true,
          runStartedAt: 1
        })
      }
    });
    const { result } = renderHook(() => useWorkspaceHasActiveRun('ws-A'));
    expect(result.current).toBe(true);
  });

  it('flips back to false when the run finishes', () => {
    useChatStore.setState({
      slices: {
        'conv-A1': chatSliceFixture({
          conversationId: 'conv-A1',
          runId: 'run-A1',
          isProcessing: true,
          runStartedAt: 1
        })
      }
    });
    const { result } = renderHook(() => useWorkspaceHasActiveRun('ws-A'));
    expect(result.current).toBe(true);

    act(() => {
      useChatStore.setState((s) => ({
        slices: {
          ...s.slices,
          'conv-A1': { ...s.slices['conv-A1']!, isProcessing: false, runId: null }
        }
      }));
    });

    expect(result.current).toBe(false);
  });
});
