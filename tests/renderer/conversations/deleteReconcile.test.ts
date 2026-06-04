import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useTimelineUiStore } from '@renderer/store/useTimelineUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

const meta = (id: string, workspaceId: string, title = id) => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  eventCount: 0,
  workspaceId
});

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
  useTimelineUiStore.setState({
    expandedByConvo: {},
    manualOverrideByConvo: {},
    hydrated: true
  });
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
    ],
    activeId: 'ws-B',
    info: { path: '/tmp/B', label: 'B' },
    loading: false
  });
  useConversationsStore.setState({
    list: [meta('conv-A', 'ws-A'), meta('conv-B', 'ws-B')],
    activeIdByWorkspace: { 'ws-A': 'conv-A', 'ws-B': 'conv-B' },
    hydratedIds: new Set<string>(['conv-A', 'conv-B']),
    loading: false
  });
  window.vyotiq.settings.set = vi.fn(async (patch: object) => patch) as never;
});

describe('useConversationsStore.remove', () => {
  it('cleans active slot, hydrated id, timeline UI, and chat slice for the deleted session', async () => {
    window.vyotiq.conversations.remove = vi.fn(async () => undefined) as never;
    useChatStore.getState().setTranscript('conv-A', []);
    useTimelineUiStore.setState({
      expandedByConvo: { 'conv-A': new Set(['row-1']) },
      manualOverrideByConvo: { 'conv-A': new Set(['row-1']) }
    });

    await useConversationsStore.getState().remove('conv-A');

    expect(window.vyotiq.conversations.remove).toHaveBeenCalledWith('conv-A');
    expect(useConversationsStore.getState().list.map((m) => m.id)).toEqual(['conv-B']);
    expect(useConversationsStore.getState().activeIdByWorkspace['ws-A']).toBeNull();
    expect(useConversationsStore.getState().hydratedIds.has('conv-A')).toBe(false);
    expect(useTimelineUiStore.getState().expandedByConvo['conv-A']).toBeUndefined();
    expect(useChatStore.getState().slices['conv-A']).toBeUndefined();
  });
});

describe('useConversationsStore.reconcileWithMain', () => {
  it('drops workspace-cascade deleted sessions from renderer state', async () => {
    useChatStore.getState().setTranscript('conv-A', []);
    useTimelineUiStore.setState({ expandedByConvo: { 'conv-A': new Set(['row-1']) } });
    useWorkspaceStore.setState({
      list: [{ id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }],
      activeId: 'ws-B',
      info: { path: '/tmp/B', label: 'B' }
    });
    window.vyotiq.conversations.list = vi.fn(async () => [meta('conv-B', 'ws-B')]) as never;

    await useConversationsStore.getState().reconcileWithMain();

    expect(useConversationsStore.getState().list.map((m) => m.id)).toEqual(['conv-B']);
    expect(useConversationsStore.getState().activeIdByWorkspace).toEqual({ 'ws-B': 'conv-B' });
    expect(useConversationsStore.getState().hydratedIds.has('conv-A')).toBe(false);
    expect(useTimelineUiStore.getState().expandedByConvo['conv-A']).toBeUndefined();
    expect(useChatStore.getState().slices['conv-A']).toBeUndefined();
  });

  it('carries a kept conversation active slot to its reparented workspace', async () => {
    useConversationsStore.setState({
      list: [meta('conv-A', 'ws-A')],
      activeIdByWorkspace: { 'ws-A': 'conv-A' },
      hydratedIds: new Set<string>(['conv-A'])
    });
    useWorkspaceStore.setState({
      list: [{ id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }],
      activeId: 'ws-B',
      info: { path: '/tmp/B', label: 'B' }
    });
    window.vyotiq.conversations.list = vi.fn(async () => [meta('conv-A', 'ws-B')]) as never;

    await useConversationsStore.getState().reconcileWithMain();

    expect(useConversationsStore.getState().activeIdByWorkspace).toEqual({ 'ws-B': 'conv-A' });
    expect(useConversationsStore.getState().list.find((m) => m.id === 'conv-A')?.workspaceId).toBe('ws-B');
  });
});
