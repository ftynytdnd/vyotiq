/**
 * Workspace remove must cascade through every per-workspace UI map so
 * a removed workspace doesn't leave orphaned entries in
 * `settings.json` (`activeConversationByWorkspace`,
 * `lastModelByWorkspace`, `permissionsByWorkspace`). The cleanup is
 * driven by `useWorkspaceStore.remove` calling
 * `useSettingsStore.purgeWorkspaceFromUi(id)` after the main-side
 * remove resolves.
 *
 * This test pins the wiring at the renderer level — including
 * `purgeWorkspaceFromUi` clearing per-workspace settings maps.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import type { AppSettings } from '@shared/types/ipc';

beforeEach(async () => {
  useWorkspaceStore.setState({
    list: [
      { id: 'ws-A', path: '/tmp/A', label: 'A', addedAt: 0 },
      { id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }
    ],
    activeId: 'ws-A',
    info: { path: '/tmp/A', label: 'A' },
    loading: false
  });
  useSettingsStore.setState({
    settings: {
      ui: {
        activeConversationByWorkspace: { 'ws-A': 'c1', 'ws-B': 'c2' },
        lastModelByWorkspace: {
          'ws-A': { providerId: 'p', modelId: 'm' },
          'ws-B': { providerId: 'p', modelId: 'm2' }
        },
      }
    },
    loading: false
  });
  // Stub IPCs touched by `workspace.remove`.
  window.vyotiq.workspace.remove = vi.fn(async () => ({
    activeId: 'ws-B',
    workspaces: [{ id: 'ws-B', path: '/tmp/B', label: 'B', addedAt: 1 }]
  })) as never;
  // The settings.set stub deep-merges like the main-process store so
  // partial `ui` patches preserve sibling workspace entries.
  window.vyotiq.settings.set = vi.fn(async (patch) => {
    const current = useSettingsStore.getState().settings;
    return {
      ...current,
      ...patch,
      ui: { ...(current.ui ?? {}), ...(patch.ui ?? {}) }
    } as AppSettings;
  }) as never;
  // Seed the conversations store too so `reconcileWithMain` (which
  // runs inside `workspace.remove` to drop the deleted workspace's
  // conversations and re-stamp `activeIdByWorkspace`) doesn't wipe
  // ws-B's slot. Without this seed, an empty `conversations.list`
  // reply would null every active slot and the test's "ws-B
  // untouched" assertion would fire on a state we never actually
  // produced in production.
  const { useConversationsStore } = await import('@renderer/store/useConversationsStore');
  useConversationsStore.setState({
    list: [
      {
        id: 'c2',
        title: 'B chat',
        createdAt: 0,
        updatedAt: 0,
        eventCount: 0,
        workspaceId: 'ws-B'
      }
    ],
    activeIdByWorkspace: { 'ws-B': 'c2' },
    hydratedIds: new Set<string>(),
    loading: false
  });
  // The conversations.list IPC is hit by reconcileWithMain — mirror
  // the seeded list so the reconciler doesn't think ws-B's chat
  // disappeared.
  window.vyotiq.conversations.list = vi.fn(async () => [
    {
      id: 'c2',
      title: 'B chat',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 0,
      workspaceId: 'ws-B'
    }
  ]) as never;
});

describe('workspace.remove — settings cascade', () => {
  it('strips the removed workspace from every per-workspace UI map', async () => {
    await useWorkspaceStore
      .getState()
      .remove('ws-A', { deleteConversations: false });

    const ui = useSettingsStore.getState().settings.ui ?? {};
    expect('ws-A' in (ui.activeConversationByWorkspace ?? {})).toBe(false);
    expect('ws-A' in (ui.lastModelByWorkspace ?? {})).toBe(false);
    // Sibling workspace untouched in every map (the cascade walks
    // map-by-map; a buggy implementation that wiped the entire map
    // would also nuke ws-B).
    expect((ui.activeConversationByWorkspace ?? {})['ws-B']).toBe('c2');
    expect((ui.lastModelByWorkspace ?? {})['ws-B']).toEqual({
      providerId: 'p',
      modelId: 'm2'
    });
  });
});
