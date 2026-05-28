/**
 * Phase 0.4 — active mirror sync should not call `select()` when the chat
 * mirror already points at a hydrated conversation (avoids supersede churn).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore, __resetSelectSpinnerForTests } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

beforeEach(() => {
  __resetSelectSpinnerForTests();
  useChatStore.setState({
    slices: { 'conv-a': { events: [], assistantTexts: {}, reasoningTexts: {}, subagents: {} } },
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: 'conv-a',
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useConversationsStore.setState({
    list: [
      {
        id: 'conv-a',
        title: 'A',
        createdAt: 0,
        updatedAt: 0,
        eventCount: 0,
        workspaceId: 'ws-test'
      }
    ],
    activeIdByWorkspace: { 'ws-test': 'conv-a' },
    hydratedIds: new Set(['conv-a']),
    loading: false,
    selecting: false
  });
  useWorkspaceStore.setState({
    list: [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }],
    activeId: 'ws-test',
    info: { path: '/tmp/ws', label: 'ws' },
    loading: false
  });
});

describe('active mirror — skip redundant select', () => {
  it('select() short-circuits without IPC when already active and hydrated', async () => {
    const read = vi.fn();
    window.vyotiq.conversations.read = read as never;

    await useConversationsStore.getState().select('conv-a');

    expect(read).not.toHaveBeenCalled();
    expect(useChatStore.getState().conversationId).toBe('conv-a');
  });
});
